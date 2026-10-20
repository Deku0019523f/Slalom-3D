// Personnalisation du skieur : catalogue (personnages, tenues, skis, casques, accessoires),
// règles de déblocage. Le modèle 3D articulé est dans avatar.js.
export { AVATAR_STYLES, DEFAULT_AVATAR, sanitizeAvatar } from './avatar-config.js';

export const CATEGORIES = [
    { key: 'character', store: 'characters', label: 'Skieur', icon: '🧑‍🎿' },
    { key: 'outfit', store: 'outfits', label: 'Tenue', icon: '🧥' },
    { key: 'skis', store: 'skis', label: 'Skis', icon: '🎿' },
    { key: 'helmet', store: 'helmets', label: 'Casque', icon: '⛑️' },
    { key: 'accessory', store: 'accessories', label: 'Accessoire', icon: '🧣' }
];

const free = { type: 'free' };
const lvl = (value) => ({ type: 'level', value });
const coins = (value) => ({ type: 'coins', value });
const trophy = (id) => ({ type: 'trophy', id });

export const CATALOG = {
    character: [
        { id: 'c_alex', name: 'Alex', desc: 'Le skieur polyvalent.', skin: 0xfdba74, hair: 'short', hairColor: 0x3b2a1a, scale: [1, 1, 1], unlock: free },
        { id: 'c_maya', name: 'Maya', desc: 'Légère et rapide, queue-de-cheval.', skin: 0xe8b08a, hair: 'ponytail', hairColor: 0x7c2d12, scale: [0.94, 0.96, 0.94], unlock: lvl(3) },
        { id: 'c_kenzo', name: 'Kenzo', desc: 'Grand gabarit, regard de champion.', skin: 0xc68642, hair: 'short', hairColor: 0x111827, scale: [1.04, 1.1, 1.04], unlock: coins(300) },
        { id: 'c_yeti', name: 'Yéti', desc: 'Une légende des cimes enneigées.', skin: 0xbfdbfe, hair: 'fur', hairColor: 0xf1f5f9, scale: [1.14, 1.12, 1.14], unlock: lvl(10) }
    ],
    outfit: [
        { id: 'o_red', name: 'Rouge course', jacket: 0xef4444, pants: 0x0f172a, accent: 0xffffff, unlock: free },
        { id: 'o_blue', name: 'Bleu glacier', jacket: 0x2563eb, pants: 0x0f172a, accent: 0xffffff, unlock: free },
        { id: 'o_green', name: 'Vert sapin', jacket: 0x10b981, pants: 0x14281f, accent: 0xffffff, unlock: free },
        { id: 'o_amber', name: 'Ambre', jacket: 0xf59e0b, pants: 0x292524, accent: 0xffffff, unlock: free },
        { id: 'o_purple', name: 'Violet', jacket: 0xa855f7, pants: 0x1e1b4b, accent: 0xffffff, unlock: free },
        { id: 'o_carbon', name: 'Noir carbone', jacket: 0x1f2937, pants: 0x0b1220, accent: 0x22d3ee, unlock: lvl(5) },
        { id: 'o_neon', name: 'Rose néon', jacket: 0xf472b6, pants: 0x312e81, accent: 0xa7f3d0, unlock: coins(250) },
        { id: 'o_gold', name: 'Or champion', jacket: 0xeab308, pants: 0x422006, accent: 0xffffff, unlock: trophy('score_5000') }
    ],
    skis: [
        { id: 's_yellow', name: 'Jaune classique', color: 0xfacc15, color2: 0xfacc15, unlock: free },
        { id: 's_red', name: 'Rouge feu', color: 0xdc2626, color2: 0xdc2626, unlock: lvl(2) },
        { id: 's_carbon', name: 'Carbone', color: 0x111827, color2: 0x111827, unlock: coins(150) },
        { id: 's_ice', name: 'Givre', color: 0x67e8f9, color2: 0x67e8f9, unlock: lvl(6) },
        { id: 's_duo', name: 'Duo rouge & bleu', color: 0xef4444, color2: 0x2563eb, unlock: coins(500) }
    ],
    helmet: [
        { id: 'h_blue', name: 'Casque bleu', kind: 'shell', color: 0x2563eb, unlock: free },
        { id: 'h_red', name: 'Casque rouge', kind: 'shell', color: 0xdc2626, unlock: lvl(2) },
        { id: 'h_white', name: 'Casque blanc', kind: 'shell', color: 0xf8fafc, unlock: coins(100) },
        { id: 'h_beanie', name: 'Bonnet à pompon', kind: 'beanie', color: 0xf97316, unlock: lvl(3) },
        { id: 'h_gold', name: 'Casque doré', kind: 'shell', color: 0xfacc15, unlock: coins(400) },
        { id: 'h_viking', name: 'Casque viking', kind: 'viking', color: 0x94a3b8, unlock: coins(600) }
    ],
    accessory: [
        { id: 'a_none', name: 'Aucun', kind: 'none', unlock: free },
        { id: 'a_scarf', name: 'Écharpe', kind: 'scarf', unlock: lvl(4) },
        { id: 'a_backpack', name: 'Sac à dos', kind: 'backpack', unlock: coins(200) },
        { id: 'a_cape', name: 'Cape de héros', kind: 'cape', unlock: trophy('total_gates_100') }
    ]
};

export const DEFAULT_LOADOUT = { character: 'c_alex', outfit: 'o_red', skis: 's_yellow', helmet: 'h_blue', accessory: 'a_none' };

export function findItem(catKey, id) {
    return (CATALOG[catKey] || []).find(i => i.id === id) || null;
}

function storeOf(catKey) {
    return CATEGORIES.find(c => c.key === catKey).store;
}

export function isUnlocked(save, catKey, id) {
    const item = findItem(catKey, id);
    if (!item) return false;
    if (item.unlock.type === 'free') return true;
    return save.unlocks[storeOf(catKey)].includes(id);
}

/** Texte lisible décrivant la condition de déblocage. */
export function unlockText(item, trophyTitle = (id) => id) {
    const u = item.unlock;
    switch (u.type) {
        case 'free': return 'Débloqué';
        case 'level': return `Niveau ${u.value} requis`;
        case 'coins': return `${u.value} pièces`;
        case 'trophy': return `Trophée « ${trophyTitle(u.id)} »`;
        default: return '';
    }
}

/**
 * Débloque automatiquement les objets dont la condition (niveau / trophée) est remplie.
 * Retourne la liste des nouveautés pour les afficher au joueur.
 */
export function syncUnlocks(save, level) {
    const fresh = [];
    for (const cat of CATEGORIES) {
        const list = save.unlocks[cat.store];
        for (const item of CATALOG[cat.key]) {
            const u = item.unlock;
            if (u.type === 'free' || list.includes(item.id)) continue;
            const met = (u.type === 'level' && level >= u.value) || (u.type === 'trophy' && !!save.trophies[u.id]);
            if (met) { list.push(item.id); fresh.push({ cat: cat.key, id: item.id, name: item.name }); }
        }
    }
    return fresh;
}

/** Achat avec la monnaie virtuelle (uniquement pour les objets de type "coins"). */
export function purchase(save, catKey, id) {
    const item = findItem(catKey, id);
    if (!item) return { ok: false, reason: 'Objet inconnu.' };
    if (isUnlocked(save, catKey, id)) return { ok: false, reason: 'Déjà débloqué.' };
    if (item.unlock.type !== 'coins') return { ok: false, reason: 'Cet objet se débloque par progression.' };
    if (save.progress.coins < item.unlock.value) return { ok: false, reason: `Il manque ${item.unlock.value - save.progress.coins} pièces.` };
    save.progress.coins -= item.unlock.value;
    save.unlocks[storeOf(catKey)].push(id);
    return { ok: true };
}

/** Équipement valide : retombe sur l'élément par défaut si l'id est inconnu ou verrouillé. */
export function resolveLoadout(save) {
    const out = {};
    for (const cat of CATEGORIES) {
        const wanted = save.loadout[cat.key];
        out[cat.key] = isUnlocked(save, cat.key, wanted) ? wanted : DEFAULT_LOADOUT[cat.key];
    }
    return out;
}
