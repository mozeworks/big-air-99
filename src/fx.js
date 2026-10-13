import * as THREE from 'three';

export function buildSky(scene) {
    const geo = new THREE.SphereGeometry(1500, 24, 12);
    const top = new THREE.Color(0x2f6fc4), mid = new THREE.Color(0x8fbfe8), low = new THREE.Color(0xdbe9f7);
    const cols = [];
    const c = new THREE.Color();
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const t = pos.getY(i) / 1500;
        if (t > 0.25) c.copy(mid).lerp(top, Math.min(1, (t - 0.25) / 0.6));
        else c.copy(low).lerp(mid, Math.max(0, t / 0.25));
        cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -1;
    scene.add(sky);
    return sky;
}

// Dark disc that sits on the snow under the rider and fades with height.
export class BlobShadow {
    constructor(scene) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const g = canvas.getContext('2d');
        const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
        grad.addColorStop(0, 'rgba(20,30,60,0.55)');
        grad.addColorStop(1, 'rgba(20,30,60,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
        const tex = new THREE.CanvasTexture(canvas);
        this.mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
        );
        this.mesh.renderOrder = 1;
        scene.add(this.mesh);
        this._q = new THREE.Quaternion();
    }

    update(x, groundY, z, normal, height, yaw) {
        this.mesh.position.set(x, groundY + 0.03, z);
        this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        this.mesh.quaternion.copy(this._q);
        this.mesh.rotateZ(yaw);
        const fade = Math.max(0, 1 - height / 30);
        this.mesh.material.opacity = fade;
        const s = 1 + height * 0.06;
        this.mesh.scale.set(0.9 * s, 1.9 * s, 1);
    }
}

export class Spray {
    constructor(scene, max = 600) {
        this.max = max;
        this.pos = new Float32Array(max * 3);
        this.vel = new Float32Array(max * 3);
        this.life = new Float32Array(max);
        this.next = 0;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
        this.points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false }));
        this.points.frustumCulled = false;
        scene.add(this.points);
        for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -1e5;
    }

    emit(origin, baseVel, count, spread = 2.5, up = 1.5) {
        for (let n = 0; n < count; n++) {
            const i = this.next;
            this.next = (this.next + 1) % this.max;
            this.pos[i * 3] = origin.x + (Math.random() - 0.5) * 0.4;
            this.pos[i * 3 + 1] = origin.y + Math.random() * 0.2;
            this.pos[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.4;
            this.vel[i * 3] = baseVel.x + (Math.random() - 0.5) * spread;
            this.vel[i * 3 + 1] = baseVel.y + Math.random() * up;
            this.vel[i * 3 + 2] = baseVel.z + (Math.random() - 0.5) * spread;
            this.life[i] = 0.5 + Math.random() * 0.7;
        }
    }

    update(dt) {
        for (let i = 0; i < this.max; i++) {
            if (this.life[i] <= 0) continue;
            this.life[i] -= dt;
            if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -1e5; continue; }
            const k = Math.exp(-2.5 * dt);
            this.vel[i * 3] *= k; this.vel[i * 3 + 2] *= k;
            this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - 6 * dt;
            this.pos[i * 3] += this.vel[i * 3] * dt;
            this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
            this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        }
        this.points.geometry.attributes.position.needsUpdate = true;
    }
}
