// Réglages de personnalisation de l'avatar 3D (sans dépendance : utilisable par storage.js, l'UI et les tests).
export const AVATAR_STYLES = [
    { id: 'classic', name: 'Classique Pro', icon: '⛑️' },
    { id: 'crest', name: 'Crête Aéro', icon: '🦈' },
    { id: 'cyber', name: 'Oreilles Cyber', icon: '🐱' },
    { id: 'viking', name: 'Cornes Viking', icon: '🐂' }
];

/** Chaîne vide = « couleur du catalogue » (aucune surcharge). */
export const DEFAULT_AVATAR = { jacket: '', skis: '', mask: '', helmet: '', bib: 225, style: 'classic' };

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Valide une personnalisation issue du stockage ou de l'interface. Ne lève jamais d'exception. */
export function sanitizeAvatar(raw) {
    const d = DEFAULT_AVATAR;
    const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const hex = (v) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : '');
    const n = Number(o.bib);
    return {
        jacket: hex(o.jacket),
        skis: hex(o.skis),
        mask: hex(o.mask),
        helmet: hex(o.helmet),
        bib: Number.isFinite(n) ? Math.min(999, Math.max(0, Math.round(n))) : d.bib,
        style: AVATAR_STYLES.some((s) => s.id === o.style) ? o.style : d.style
    };
}
