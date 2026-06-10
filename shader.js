/* ============================================================
   Prisma — Ring Background (Canvas2D)
   3 rings, dark blue, 20s cycle, ghostly professional look.
============================================================ */
(function () {
    'use strict';

    /* Blue-500 — #3B82F6 — dark, rich, professional */
    var R = 59, G = 130, B = 246;

    var RING_COUNT = 3;
    var SPEED      = 0.000050; /* ~20s per full cycle */

    function initAnimation() {
        var container = document.getElementById('shader-bg');
        if (!container) return;

        var canvas = document.createElement('canvas');
        var ctx    = canvas.getContext('2d');
        canvas.style.cssText = 'display:block;width:100%;height:100%;';
        container.appendChild(canvas);

        var W, H, CX, CY, MAX_R;

        function resize() {
            W     = canvas.width  = window.innerWidth;
            H     = canvas.height = window.innerHeight;
            CX    = W / 2;
            CY    = H / 2;
            MAX_R = Math.sqrt(CX * CX + CY * CY) * 1.10;
        }
        resize();
        window.addEventListener('resize', resize);

        /* Opacity envelope: fade in → plateau → fade out */
        function envelope(phase) {
            if (phase < 0.10) return phase / 0.10;
            if (phase < 0.70) return 1.0;
            return Math.pow(1 - (phase - 0.70) / 0.30, 1.8);
        }

        function drawCenterGlow() {
            var grad = ctx.createRadialGradient(CX, CY, 0, CX, CY, MAX_R * 0.42);
            grad.addColorStop(0,   'rgba(' + R + ',' + G + ',' + B + ',0.055)');
            grad.addColorStop(0.4, 'rgba(' + R + ',' + G + ',' + B + ',0.018)');
            grad.addColorStop(1,   'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);
        }

        function drawRing(radius, alpha) {
            if (radius < 1 || alpha < 0.004) return;

            /* outer diffuse halo */
            ctx.beginPath();
            ctx.arc(CX, CY, radius, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(' + R + ',' + G + ',' + B + ',' + (alpha * 0.09) + ')';
            ctx.lineWidth   = 22;
            ctx.stroke();

            /* mid soft glow */
            ctx.beginPath();
            ctx.arc(CX, CY, radius, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(' + R + ',' + G + ',' + B + ',' + (alpha * 0.22) + ')';
            ctx.lineWidth   = 5;
            ctx.stroke();

            /* crisp leading edge */
            ctx.beginPath();
            ctx.arc(CX, CY, radius, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(' + R + ',' + G + ',' + B + ',' + (alpha * 0.55) + ')';
            ctx.lineWidth   = 1.2;
            ctx.stroke();
        }

        /* Stagger ring phases evenly */
        var rings = [];
        for (var i = 0; i < RING_COUNT; i++) {
            rings.push({ phase: (i + 0.5) / RING_COUNT });
        }

        var last = null;

        function draw(ts) {
            requestAnimationFrame(draw);
            var dt = last === null ? 16 : Math.min(ts - last, 50);
            last = ts;

            /* Background */
            ctx.fillStyle = '#020617';
            ctx.fillRect(0, 0, W, H);

            drawCenterGlow();

            for (var j = 0; j < rings.length; j++) {
                rings[j].phase = (rings[j].phase + SPEED * dt) % 1;
                var alpha = envelope(rings[j].phase);
                drawRing(rings[j].phase * MAX_R, alpha);
            }
        }

        requestAnimationFrame(draw);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAnimation);
    } else {
        initAnimation();
    }
}());
