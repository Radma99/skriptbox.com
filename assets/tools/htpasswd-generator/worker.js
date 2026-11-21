// Rechnet Hashes abseits der Seite, damit bcrypt mit hohen Kosten die Oberfläche nicht einfriert.
// Nachricht: { id, type: 'hash' | 'verify', password, algorithm, cost, hash }
import { createHash, verify } from './htpasswd.js';

self.addEventListener('message', ({ data }) => {
    const onProgress = (share) => self.postMessage({ id: data.id, progress: share });

    try {
        const result = data.type === 'verify'
            ? verify(data.hash, data.password, onProgress)
            : createHash(data.password, { algorithm: data.algorithm, cost: data.cost, onProgress });

        self.postMessage({ id: data.id, result });
    } catch (error) {
        self.postMessage({ id: data.id, error: error.message });
    }
});
