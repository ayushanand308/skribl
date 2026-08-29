import { PrismaClient } from '@prisma/client';

export async function seedWordPacks(prisma: PrismaClient) {
    console.log('[WordPackSeeder] Seeding default word packs and words...');

    const defaultPack = await prisma.wordPack.upsert({
        where: { id: 'default-english-pack' },
        update: {},
        create: {
            id: 'default-english-pack',
            name: 'Standard English',
            language: 'en',
            isDefault: true,
        },
    });

    const defaultWords = [
        { text: 'apple', difficulty: 1 },
        { text: 'banana', difficulty: 1 },
        { text: 'cat', difficulty: 1 },
        { text: 'dog', difficulty: 1 },
        { text: 'elephant', difficulty: 2 },
        { text: 'guitar', difficulty: 2 },
        { text: 'house', difficulty: 1 },
        { text: 'mountain', difficulty: 2 },
        { text: 'pyramid', difficulty: 3 },
        { text: 'sunflower', difficulty: 2 },
        { text: 'airplane', difficulty: 1 },
        { text: 'computer', difficulty: 2 },
    ];

    for (const w of defaultWords) {
        await prisma.word.upsert({
            where: { id: `word-${defaultPack.id}-${w.text}` },
            update: {},
            create: {
                id: `word-${defaultPack.id}-${w.text}`,
                wordPackId: defaultPack.id,
                text: w.text,
                difficulty: w.difficulty,
            },
        });
    }

    console.log(`[WordPackSeeder] Seeded ${defaultWords.length} words into '${defaultPack.name}' pack.`);
}
