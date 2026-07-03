(function () {
    const CONFIG = {
        wheelSpinDuration: 6000,
        timerDuration: 3600,
        audioSrc: 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmAaBzeS1/LNeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmAaBzeS1/LNeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmAaBzeS1/LNeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmAaBzeS1/LNeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmAaBzeS1/LNeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmAaBzeS1/LNeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmAaBzeS1/LNeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmAaBzeS1/LNeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmAaBzeS1/LNeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmAaBzeS1/LNeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmAaBzeS1/LNeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmAaBzeS1/LNeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmAaBzuO'
    };

    function selectElements() {
        return {
            kit: document.querySelector('.wheel-kit'),
            wheelSection: document.getElementById('wheelSection'),
            wheelRotate: document.getElementById('wheelRotate'),
            spinButton: document.getElementById('spinButton'),
            wheelPopup: document.getElementById('wheelPopup'),
            popupClose: document.getElementById('popupClose'),
            popupOk: document.getElementById('popupOk'),
            orderForm: document.getElementById('orderForm'),
            hoursDisplay: document.getElementById('hoursDisplay'),
            minutesDisplay: document.getElementById('minutesDisplay'),
            secondsDisplay: document.getElementById('secondsDisplay')
        };
    }

    function formatTime(unit) {
        return String(unit).padStart(2, '0');
    }

    document.addEventListener('DOMContentLoaded', () => {
        const elements = selectElements();

        if (!elements.kit || !elements.spinButton || !elements.wheelRotate || !elements.wheelPopup) {
            return;
        }

        let timerId = null;
        let timeLeft = CONFIG.timerDuration;
        let hasSpun = false;
        const defaultButtonText = elements.spinButton.textContent.trim();

        function restrictToNumbers(inputElement) {
            inputElement.addEventListener('input', function onInput() {
                this.value = this.value.replace(/(?!^\+)[^\d]/g, '');
            });
        }

        function setupFormValidation() {
            if (!elements.orderForm) {
                return;
            }

            const phoneInputs = elements.orderForm.querySelectorAll('input[name="phone"]');
            const nameInputs = elements.orderForm.querySelectorAll('input[name="name"]');

            phoneInputs.forEach((input) => {
                input.setAttribute('required', 'required');
                restrictToNumbers(input);
            });

            nameInputs.forEach((input) => {
                input.setAttribute('required', 'required');
            });
        }

        function updateTimerDisplays() {
            if (!elements.hoursDisplay || !elements.minutesDisplay || !elements.secondsDisplay) {
                return;
            }

            const hours = Math.floor(timeLeft / 3600);
            const minutes = Math.floor((timeLeft % 3600) / 60);
            const seconds = timeLeft % 60;

            elements.hoursDisplay.textContent = formatTime(hours);
            elements.minutesDisplay.textContent = formatTime(minutes);
            elements.secondsDisplay.textContent = formatTime(seconds);
        }

        function tickTimer() {
            if (timeLeft <= 0) {
                stopTimer();
                timeLeft = 0;
                updateTimerDisplays();
                return;
            }

            timeLeft -= 1;
            updateTimerDisplays();
        }

        function startTimer() {
            if (timerId) {
                return;
            }

            updateTimerDisplays();
            timerId = window.setInterval(tickTimer, 1000);
        }

        function stopTimer() {
            if (timerId) {
                window.clearInterval(timerId);
                timerId = null;
            }
        }

        function playAudioCue() {
            if (!CONFIG.audioSrc) {
                return;
            }

            try {
                const audio = new Audio(CONFIG.audioSrc);
                audio.play().catch(() => { /* ignore autoplay issues */ });
            } catch (_err) {
                /* ignore audio errors */
            }
        }

        function openPopup() {
            elements.wheelPopup.classList.add('show2');
            elements.wheelPopup.setAttribute('aria-hidden', 'false');
            elements.popupOk?.focus({ preventScroll: true });
        }

        function hideWheel() {
            if (elements.wheelSection) {
                elements.wheelSection.classList.add('hidden');
                elements.wheelSection.setAttribute('aria-hidden', 'true');
            }
        }

        function showForm() {
            if (!elements.orderForm) {
                return;
            }

            elements.orderForm.classList.add('show');
            elements.orderForm.setAttribute('aria-hidden', 'false');
            startTimer();
        }

        function closePopup() {
            elements.wheelPopup.classList.remove('show2');
            elements.wheelPopup.setAttribute('aria-hidden', 'true');
            hideWheel();
            showForm();
        }

        function resetButtonState() {
            elements.spinButton.textContent = defaultButtonText || 'Griezt';
            elements.spinButton.style.opacity = '';
        }

        function triggerSpin() {
            if (hasSpun) {
                return;
            }

            hasSpun = true;
            elements.spinButton.disabled = true;
            elements.spinButton.textContent = elements.spinButton.dataset.loadingText || 'Sukasi...';
            elements.spinButton.style.opacity = '0.7';

            elements.wheelRotate.classList.remove('super-rotation');
            void elements.wheelRotate.offsetWidth; // force reflow
            elements.wheelRotate.classList.add('super-rotation');

            playAudioCue();

            window.setTimeout(() => {
                openPopup();
                resetButtonState();
            }, CONFIG.wheelSpinDuration);
        }

        function handleKeydown(event) {
            if (event.key === 'Escape' && elements.wheelPopup.classList.contains('show2')) {
                closePopup();
            }
        }

        function handleOverlayClick(event) {
            if (event.target === elements.wheelPopup) {
                closePopup();
            }
        }

        updateTimerDisplays();
        elements.wheelPopup.setAttribute('aria-hidden', 'true');
        elements.orderForm?.setAttribute('aria-hidden', 'true');
        elements.spinButton.addEventListener('click', triggerSpin);
        elements.popupClose?.addEventListener('click', closePopup);
        elements.popupOk?.addEventListener('click', closePopup);
        elements.wheelPopup.addEventListener('click', handleOverlayClick);
        document.addEventListener('keydown', handleKeydown);
        window.addEventListener('beforeunload', stopTimer);
        setupFormValidation();

        window.wheelKit = {
            spin: triggerSpin,
            closePopup,
            startTimer,
            stopTimer
        };
    });
})();
