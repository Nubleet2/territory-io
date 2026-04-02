'use strict';

const XP = (() => {

    function award(type) {
        if (GAME.player.level >= 99) return; // level cap
        const amt = {
            kill:            CONFIG.XP_KILL,
            buildingDestroy: CONFIG.XP_BLDG_DESTROY,
            capture:         CONFIG.XP_CAPTURE,
            build:           CONFIG.XP_BUILD,
        }[type] || 0;
        if (!amt) return;

        GAME.player.xp += amt;
        const xpNeeded = CONFIG.XP_PER_LEVEL;

        if (GAME.player.xp >= xpNeeded) {
            GAME.player.xp      -= xpNeeded;
            GAME.player.level   += 1;
            GAME.player.statPoints += CONFIG.STAT_POINTS_LEVEL;
            UI.showLevelUp();
            Audio.play('levelup');
        }
    }

    // Apply a stat point allocation
    function upgradeStat(stat) {
        if (GAME.player.statPoints <= 0) return false;
        GAME.player.statPoints--;
        GAME.player.upgrades[stat] = (GAME.player.upgrades[stat] || 0) + 1;
        Player.refreshStats();
        return true;
    }

    return { award, upgradeStat };
})();
