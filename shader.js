/* ============================================================
   Prisma — Luxury Circular Wave Background (WebGL / Three.js)
   Ondas circulares expandindo do centro — paleta navy/sky blue

   Baseado no shader de referência do usuário, adaptado para:
   · max(resolution) → anéis cobrem toda a tela
   · Paleta azul luxuosa (sem rainbow)
   · Espaçamento 0.2 entre anéis → 1-2 anéis visíveis por vez
   · Brilho progressivo (i*i) → clima premium
============================================================ */
(function () {
    'use strict';

    function initShaderAnimation() {
        /* Respect prefers-reduced-motion */
        try {
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        } catch (e) { /* ignore */ }

        var THREE = window.THREE;
        if (!THREE) {
            console.warn('[Prisma] Three.js não encontrado — shader desabilitado.');
            return;
        }

        var container = document.getElementById('shader-bg');
        if (!container) return;

        /* ── Scene setup ─────────────────────────────────────── */
        var camera = new THREE.Camera();
        camera.position.z = 1;

        var scene    = new THREE.Scene();
        var geometry = new THREE.PlaneGeometry(2, 2);

        var uniforms = {
            time:       { type: 'f',  value: 1.0 },
            resolution: { type: 'v2', value: new THREE.Vector2() }
        };

        var vertexShader = 'void main() { gl_Position = vec4(position, 1.0); }';

        /* ── Fragment shader ──────────────────────────────────────
           Ondas circulares perfeitas (sem mod) com paleta luxury.

           Loop estrutura (do shader de referência):
           · j=0..2 — 3 canais RGB com offset de fase mínimo (0.008)
             → cria um halo prismático sutil nos anéis
           · i=0..4 — 5 anéis com peso float(i*i):
             i=0 → 0 (invisível = pausa rítmica elegante)
             i=1 → 1 (tênue)
             i=2 → 4 (médio)
             i=3 → 9 (brilhante)
             i=4 → 16 (mais brilhante — clímax visual)
           · Espaçamento 0.2 entre anéis → anéis bem separados
             (1-2 anéis simultâneos na tela a cada instante)

           Tinting luxury:
           · red   × 0.07 → suprime vermelho → azul dominante
           · green × 0.28 → shimmer teal-blue
           · blue  × 1.00 → canal azul puro
           → cor no pico: rgb(19, 79, 255) ≈ #134FFF (sky-blue vívido)
        ───────────────────────────────────────────────────── */
        var fragmentShader = [
            'precision highp float;',
            'uniform vec2  resolution;',
            'uniform float time;',

            'void main(void) {',

            /* Normaliza por max(w,h) → anéis cobrem toda a tela em
               qualquer aspect ratio (16:9, 21:9, portrait, etc.)     */
            '    vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy)',
            '              / max(resolution.x, resolution.y);',

            '    float t = time * 0.05;',
            '    float lineWidth = 0.003;',

            /* Loop RGB com offset de fase 0.008 por canal —
               cria halo prismático azul-cyan nos anéis               */
            '    vec3 color = vec3(0.0);',
            '    for(int j = 0; j < 3; j++){',
            '        for(int i = 0; i < 5; i++){',
            '            color[j] += lineWidth * float(i * i) /',
            '                max(abs(fract(t - 0.008 * float(j) + float(i) * 0.2) * 5.0',
            '                    - length(uv)), 0.0002);',
            '        }',
            '    }',

            /* Clamp antes do tinting para preservar a forma do halo  */
            '    color = clamp(color, 0.0, 1.0);',

            /* Tinting luxury: red × 0.07 / green × 0.28 / blue × 1.0
               No pico: (0.07, 0.28, 1.0) → azul royal vívido         */
            '    color *= vec3(0.07, 0.28, 1.00);',

            /* Vinheta radial suave — centro ligeiramente mais quente  */
            '    float r     = length(uv);',
            '    float depth = exp(-r * r * 0.15);',

            /* Base navy #050E1A + glow dos anéis + atmosfera central  */
            '    vec3 base = vec3(0.020, 0.055, 0.102);',
            '    vec3 atmo = vec3(0.006, 0.020, 0.072) * depth;',
            '    vec3 col  = base + color + atmo;',
            '    col = clamp(col, 0.0, 1.0);',

            '    gl_FragColor = vec4(col, 1.0);',
            '}'
        ].join('\n');

        /* ── Material & mesh ─────────────────────────────────── */
        var material = new THREE.ShaderMaterial({
            uniforms:       uniforms,
            vertexShader:   vertexShader,
            fragmentShader: fragmentShader
        });

        scene.add(new THREE.Mesh(geometry, material));

        /* ── Renderer ────────────────────────────────────────── */
        var renderer = new THREE.WebGLRenderer({ antialias: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.domElement.style.cssText =
            'display:block;width:100%;height:100%;';
        container.appendChild(renderer.domElement);

        /* ── Resize ──────────────────────────────────────────── */
        function resize() {
            var w = window.innerWidth;
            var h = window.innerHeight;
            renderer.setSize(w, h);
            uniforms.resolution.value.x = renderer.domElement.width;
            uniforms.resolution.value.y = renderer.domElement.height;
        }

        resize();
        window.addEventListener('resize', resize);

        /* ── Animation loop ──────────────────────────────────── */
        (function animate() {
            requestAnimationFrame(animate);
            uniforms.time.value += 0.05;
            renderer.render(scene, camera);
        }());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initShaderAnimation);
    } else {
        initShaderAnimation();
    }
}());
