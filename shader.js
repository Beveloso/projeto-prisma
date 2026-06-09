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
        var THREE = window.THREE;
        if (!THREE) return;

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
           Anéis circulares luxury — FULLY UNROLLED (sem dynamic
           vec3 indexing, compatível com ANGLE/DirectX no Windows).

           3 canais separados com offset de fase 0.008 entre eles
           → halo prismático azul-ciano sutil nos anéis.
           i=0 ignorado (peso 0). i=1..4: pesos 1, 4, 9, 16.
           Tinting: red×0.07 / green×0.28 / blue×1.0 → #185AFF
        ───────────────────────────────────────────────────── */
        var fragmentShader = [
            'precision highp float;',
            'uniform vec2  resolution;',
            'uniform float time;',

            /* helper: ring contribution for one channel             */
            'float ring(float t, float off, float len) {',
            '    float lw = 0.003;',
            '    float s = 0.0;',
            '    s += lw *  1.0 / max(abs(fract(t + off + 0.2) * 5.0 - len), 0.0002);',
            '    s += lw *  4.0 / max(abs(fract(t + off + 0.4) * 5.0 - len), 0.0002);',
            '    s += lw *  9.0 / max(abs(fract(t + off + 0.6) * 5.0 - len), 0.0002);',
            '    s += lw * 16.0 / max(abs(fract(t + off + 0.8) * 5.0 - len), 0.0002);',
            '    return clamp(s, 0.0, 1.0);',
            '}',

            'void main(void) {',

            '    vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy)',
            '              / max(resolution.x, resolution.y);',
            '    float t   = time * 0.05;',
            '    float len = length(uv);',

            /* 3 channels, 0.008 phase offset each → subtle prism    */
            '    float cr = ring(t,  0.000, len);',
            '    float cg = ring(t, -0.008, len);',
            '    float cb = ring(t, -0.016, len);',

            /* Tint luxury: suppress red/green, keep blue dominant    */
            '    vec3 color = vec3(cr * 0.07, cg * 0.28, cb * 1.00);',

            /* Radial depth + navy base + atmospheric centre glow     */
            '    float depth = exp(-len * len * 0.15);',
            '    vec3 base   = vec3(0.020, 0.055, 0.102);',
            '    vec3 atmo   = vec3(0.006, 0.020, 0.072) * depth;',
            '    vec3 col    = clamp(base + color + atmo, 0.0, 1.0);',

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
        var renderer;
        try {
            renderer = new THREE.WebGLRenderer({ antialias: false });
        } catch (e) { return; }
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
