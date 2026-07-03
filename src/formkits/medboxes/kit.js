// Medboxes kit — self-contained "guess the box" game + order form.
// Refactored into an IIFE scoped to each .medboxes-kit root so the formerly
// global helpers (initBox/fadeOut/fadeIn) can never collide with the host page.
// The game markup lives in kit.html; this script only wires behaviour.
(function () {
    'use strict';

    function fadeOut(el, done) {
        el.style.opacity = '1';
        (function step() {
            var v = parseFloat(el.style.opacity) - 0.1;
            if (v < 0) { el.style.display = 'none'; el.style.opacity = ''; if (done) done(); }
            else { el.style.opacity = String(v); requestAnimationFrame(step); }
        })();
    }
    function fadeIn(el) {
        el.style.opacity = '0';
        el.style.display = 'block';
        (function step() {
            var v = parseFloat(el.style.opacity) + 0.1;
            if (!(v > 1)) { el.style.opacity = String(v); requestAnimationFrame(step); }
            else { el.style.opacity = ''; }
        })();
    }
    function startTimer(displayMins, displaySecs, duration) {
        var t = duration, m, s;
        var id = setInterval(function () {
            m = parseInt(t / 60, 10); s = parseInt(t % 60, 10);
            if (displayMins) displayMins.textContent = m < 10 ? '0' + m : '' + m;
            if (displaySecs) displaySecs.textContent = s < 10 ? '0' + s : '' + s;
            if (--t < 0) t = duration;
        }, 1000);
        return id;
    }

    function init(root) {
        var game = root.querySelector('[data-medboxes-game]');
        var orderBlock = root.querySelector('[data-order-block]');
        var popupWrapper = root.querySelector('[data-popup-wrapper]');
        if (!game || !orderBlock) return;

        var doors = game.querySelectorAll('.door');
        var boxes = game.querySelectorAll('.box');
        var popupOk = root.querySelector('[data-popup-ok]');

        function openBoxes(ev) {
            Array.prototype.forEach.call(boxes, function (b) { b.style.background = 'none'; });
            var tgt = ev.currentTarget;
            tgt.classList.add('open');
            tgt.classList.add('vin');
            setTimeout(function () { popupWrapper.style.display = 'block'; }, 2500);
            // reveal remaining boxes
            for (var i = 0; i < doors.length; i++) {
                if (!doors[i].classList.contains('open')) {
                    (function (d) { setTimeout(function () { d.classList.add('open'); }, 1500); })(doors[i]);
                }
                doors[i].removeEventListener('click', openBoxes);
            }
        }
        function spin() {
            setTimeout(function () {
                fadeOut(game, function () {});
                fadeIn(orderBlock);
                // timer (only if the landing ships a timer display slot)
                var m = root.querySelector('[data-min]'), s = root.querySelector('[data-sec]');
                if (m || s) startTimer(m, s, 60 * 10);
            }, 3000);
        }

        Array.prototype.forEach.call(boxes, function (b) { b.addEventListener('click', spin); });
        Array.prototype.forEach.call(doors, function (d) { d.addEventListener('click', openBoxes); });
        if (popupOk) popupOk.addEventListener('click', function (e) {
            e.preventDefault();
            fadeOut(popupWrapper, function () {});
        });

        // Stock countdown ("left: N units") — common urgency pattern.
        var packs = root.querySelectorAll('.lastpack');
        if (packs.length) {
            var n = 67;
            Array.prototype.forEach.call(packs, function (p) { p.textContent = '' + n; });
            setTimeout(function tick() {
                n--;
                Array.prototype.forEach.call(packs, function (p) { p.textContent = '' + n; });
                if (n > 5) setTimeout(tick, 15000);
            }, 0);
        }
    }

    function ready(fn) {
        if (document.readyState !== 'loading') fn();
        else document.addEventListener('DOMContentLoaded', fn);
    }

    ready(function () {
        var roots = document.querySelectorAll('.medboxes-kit');
        for (var i = 0; i < roots.length; i++) init(roots[i]);
    });
})();
