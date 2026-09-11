import words from "../../words.json";

export class WordBank {
    
    static sanitizeWords(rawWords: string[] | string | undefined | null): string[] {
        if (!rawWords) return [];
        let list: string[] = [];
        if (typeof rawWords === "string") {
            list = rawWords.split(/[,;\n\r]+/);
        } else if (Array.isArray(rawWords)) {
            list = rawWords.flatMap(item => typeof item === "string" ? item.split(/[,;\n\r]+/) : []);
        }
        const cleaned = list
            .map(w => w.trim().toLowerCase().replace(/\s+/g, ' '))
            .filter(w => w.length >= 2 && w.length <= 32 && /^[a-z0-9 -]+$/.test(w));
        return Array.from(new Set(cleaned));
    }

    static getRandomWords(
        count: number,
        customWords?: string[],
        customWordsOnly: boolean = false,
        usedWords?: Set<string>
    ): string[] {
        const sanitizedCustom = this.sanitizeWords(customWords);
        const used = usedWords || new Set<string>();

        if (customWordsOnly && sanitizedCustom.length >= count) {
            let available = sanitizedCustom.filter(w => !used.has(w));
            if (available.length < count) {
                available = [...sanitizedCustom];
            }
            const shuffled = [...available].sort(() => Math.random() - 0.5);
            return shuffled.slice(0, count);
        }

        if (customWordsOnly && sanitizedCustom.length > 0) {
            let available = sanitizedCustom.filter(w => !used.has(w));
            if (available.length === 0) available = [...sanitizedCustom];
            const shuffledCustom = [...available].sort(() => Math.random() - 0.5);
            const chosen = shuffledCustom.slice(0, Math.min(count, shuffledCustom.length));
            if (chosen.length < count) {
                const defaultPool = words.filter(w => !used.has(w) && !chosen.includes(w));
                const pool = defaultPool.length >= (count - chosen.length) ? defaultPool : words;
                const shuffledDefaults = [...pool].filter(w => !chosen.includes(w)).sort(() => Math.random() - 0.5);
                chosen.push(...shuffledDefaults.slice(0, count - chosen.length));
            }
            return chosen;
        }

        if (sanitizedCustom.length > 0) {
            let availableCustom = sanitizedCustom.filter(w => !used.has(w));
            if (availableCustom.length === 0) availableCustom = [...sanitizedCustom];
            const customCount = Math.min(Math.ceil(count / 2), availableCustom.length);
            const chosenCustom = [...availableCustom].sort(() => Math.random() - 0.5).slice(0, customCount);

            const defaultPool = words.filter(w => !used.has(w) && !chosenCustom.includes(w));
            const availableDefaults = defaultPool.length >= (count - chosenCustom.length) ? defaultPool : words;
            const chosenDefaults = [...availableDefaults]
                .filter(w => !chosenCustom.includes(w))
                .sort(() => Math.random() - 0.5)
                .slice(0, count - chosenCustom.length);

            const combined = [...chosenCustom, ...chosenDefaults].sort(() => Math.random() - 0.5);
            return combined.slice(0, count);
        }

        const availableDefaults = words.filter(w => !used.has(w));
        const pool = availableDefaults.length >= count ? availableDefaults : words;
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, count);
    }

    static getBlankHint(word: string): string {
        return word.split("").map(ch => ch === " " ? "  " : "_").join(" ");
    }

    static getProgressiveHint(word: string, revealCount: number): string {
        const letters = word.split("");

        const letterIndices = letters
            .map((ch, i) => (ch !== " " ? i : -1))
            .filter(i => i !== -1);

        const toReveal = new Set<number>();
        const pool = [...letterIndices].sort(() => Math.random() - 0.5);
        pool.slice(0, revealCount).forEach(i => toReveal.add(i));

        return letters
            .map((ch, i) => {
                if (ch === " ") return "  ";
                return toReveal.has(i) ? ch : "_";
            })
            .join(" ");
    }

    static calculateScore(timeElapsed: number, totalTime: number = 60): number {
        const clampedTime = Math.max(0, Math.min(timeElapsed, totalTime));
        const score = 500 - (clampedTime / totalTime) * 400;
        return Math.floor(Math.max(100, score));
    }

    static checkWordMatch(guess: string, target: string, timeElapsed: number = 0, totalTime: number = 60): { matchType: 'exact' | 'close' | 'none', score: number } {
        if (!guess || !target) return { matchType: 'none', score: 0 };
        
        const g = guess.trim().toLowerCase();
        const t = target.trim().toLowerCase();

        if (g === t) {
            return {
                matchType: 'exact',
                score: this.calculateScore(timeElapsed, totalTime)
            };
        }

        if (t.length <= 3) return { matchType: 'none', score: 0 }; 

        const maxDistance = t.length >= 6 ? 2 : 1;
        
        const track = Array(t.length + 1).fill(null).map(() => Array(g.length + 1).fill(null));
        for (let i = 0; i <= t.length; i += 1) { track[i][0] = i; }
        for (let j = 0; j <= g.length; j += 1) { track[0][j] = j; }
        
        for (let j = 1; j <= g.length; j += 1) {
            for (let i = 1; i <= t.length; i += 1) {
                const indicator = t[i - 1] === g[j - 1] ? 0 : 1;
                track[i][j] = Math.min(
                    track[i - 1][j] + 1,
                    track[i][j - 1] + 1,
                    track[i - 1][j - 1] + indicator
                );
            }
        }
        
        const distance = track[t.length][g.length];
        
        if (distance <= maxDistance) return { matchType: 'close', score: 0 };

        return { matchType: 'none', score: 0 };
    }
}
