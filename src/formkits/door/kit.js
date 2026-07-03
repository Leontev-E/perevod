(function () {
    const DEFAULTS = {
        timerSeconds: 600,
        autoOpenDelay: 2000,
        formRevealDelay: 4200,
        fadeDuration: 400,
        highPrize: '100%',
        fallbackPrizes: ['50%', '20%']
        // times are in milliseconds
    };

    function initDoorKit(root) {
        const doorArea = root.querySelector('[data-door-area]');
        const doorCards = Array.from(root.querySelectorAll('[data-door-card]'));
        const orderSection = root.querySelector('[data-order-section]');
        const timerDisplay = root.querySelector('[data-timer]');
        const prizeValueTargets = Array.from(root.querySelectorAll('[data-prize-value]'));

        if (!doorArea || doorCards.length === 0 || !orderSection || !timerDisplay) {
            return;
        }

        const config = readConfig(root);
        const doorButtons = doorCards.map(card => card.querySelector('.door-face'));
        const prizeLabels = doorCards.map(card => card.querySelector('[data-prize-label]'));

        let hasChosen = false;
        let remainingSeconds = config.timerSeconds;
        let timerId = null;

        function readTimer() {
            const minutes = String(Math.max(0, Math.floor(remainingSeconds / 60))).padStart(2, '0');
            const seconds = String(Math.max(0, remainingSeconds % 60)).padStart(2, '0');
            timerDisplay.textContent = `${minutes}:${seconds}`;
        }

        function tick() {
            if (remainingSeconds <= 0) {
                stopTimer();
                remainingSeconds = 0;
                readTimer();
                return;
            }
            remainingSeconds -= 1;
            readTimer();
        }

        function startTimer() {
            if (timerId) {
                return;
            }
            readTimer();
            timerId = window.setInterval(tick, 1000);
        }

        function stopTimer() {
            if (!timerId) {
                return;
            }
            window.clearInterval(timerId);
            timerId = null;
        }

        function applyPrizeTargets(value) {
            prizeValueTargets.forEach(node => {
                node.textContent = value;
            });
        }

        function openDoor(card) {
            card.classList.add('is-open');
            card.setAttribute('aria-pressed', 'true');
        }

        function disableButtons() {
            doorButtons.forEach(button => {
                if (button) {
                    button.disabled = true;
                    button.setAttribute('aria-disabled', 'true');
                }
            });
        }

        function handleDoorSelection(index) {
            if (hasChosen) {
                return;
            }
            hasChosen = true;

            const clickedCard = doorCards[index];
            const clickedLabel = prizeLabels[index];
            openDoor(clickedCard);
            if (clickedLabel) {
                clickedLabel.textContent = config.highPrize;
            }
            applyPrizeTargets(config.highPrize);
            disableButtons();

            const remainingCards = doorCards.filter((_, idx) => idx !== index);
            remainingCards.forEach((card, idx) => {
                const label = card.querySelector('[data-prize-label]');
                if (label) {
                    const fallbackAlt = DEFAULTS.fallbackPrizes[DEFAULTS.fallbackPrizes.length - 1] || '10%';
                    const prizeValue = config.altPrizes[idx] || config.altPrizes[config.altPrizes.length - 1] || fallbackAlt;
                    label.textContent = prizeValue;
                }
            });

            window.setTimeout(() => {
                remainingCards.forEach(openDoor);
            }, config.autoOpenDelay);

            window.setTimeout(() => {
                doorArea.classList.add('is-hidden');
                window.setTimeout(() => {
                    doorArea.style.display = 'none';
                    doorArea.setAttribute('hidden', 'hidden');
                    orderSection.classList.remove('is-hidden');
                    orderSection.removeAttribute('hidden');
                    startTimer();
                    orderSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, config.fadeDuration);
            }, config.formRevealDelay);
        }

        doorButtons.forEach((button, index) => {
            if (!button) {
                return;
            }
            button.type = 'button';
            button.setAttribute('aria-expanded', 'false');
            button.addEventListener('click', () => handleDoorSelection(index));
        });

        setupFormValidation(orderSection);
        readTimer();
        window.addEventListener('beforeunload', stopTimer);

        root.doorKit = {
            startTimer,
            stopTimer,
            reset: () => {
                stopTimer();
                hasChosen = false;
                remainingSeconds = config.timerSeconds;
                readTimer();

                doorArea.style.display = '';
                doorArea.removeAttribute('hidden');
                window.requestAnimationFrame(() => {
                    doorArea.classList.remove('is-hidden');
                });
                orderSection.classList.add('is-hidden');
                orderSection.setAttribute('hidden', 'hidden');
                doorCards.forEach(card => {
                    card.classList.remove('is-open');
                    card.removeAttribute('aria-pressed');
                });
                prizeLabels.forEach(label => {
                    if (label) {
                        label.textContent = '';
                    }
                });
                applyPrizeTargets(config.highPrize);
                doorButtons.forEach(button => {
                    if (button) {
                        button.disabled = false;
                        button.removeAttribute('aria-disabled');
                    }
                });
            }
        };
    }

    function readConfig(root) {
        const altPrizeAttr = root.dataset.prizeAlt || DEFAULTS.fallbackPrizes.join(',');
        const altPrizes = altPrizeAttr
            .split(',')
            .map(prize => prize.trim())
            .filter(Boolean);

        if (altPrizes.length === 0) {
            DEFAULTS.fallbackPrizes.forEach(prize => altPrizes.push(prize));
        }

        const timerSeconds = parseInt(root.dataset.timerSeconds, 10);

        return {
            highPrize: root.dataset.prizeHigh || DEFAULTS.highPrize,
            altPrizes,
            autoOpenDelay: parseInt(root.dataset.autoOpenDelay, 10) || DEFAULTS.autoOpenDelay,
            formRevealDelay: parseInt(root.dataset.formRevealDelay, 10) || DEFAULTS.formRevealDelay,
            fadeDuration: parseInt(root.dataset.fadeDuration, 10) || DEFAULTS.fadeDuration,
            timerSeconds: Number.isFinite(timerSeconds) && timerSeconds > 0 ? timerSeconds : DEFAULTS.timerSeconds
        };
    }

    function setupFormValidation(scope) {
        const phoneInputs = scope.querySelectorAll('input[name="phone"]');
        const nameInputs = scope.querySelectorAll('input[name="name"]');

        phoneInputs.forEach(input => {
            input.required = true;
            input.addEventListener('input', () => {
                input.value = input.value.replace(/(?!^\+)[^\d]/g, '');
            });
        });

        nameInputs.forEach(input => {
            input.required = true;
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('.door-kit').forEach(initDoorKit);
    });
})();
