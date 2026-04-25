import words from "../../words.json";

export class WordBank {
    
    static getRandomWords(count: number): string[] {
        const shuffled = [...words].sort(() => Math.random() - 0.5);
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
