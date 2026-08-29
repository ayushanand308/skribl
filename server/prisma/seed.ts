import { PrismaClient } from '@prisma/client';
import { seedWordPacks } from './seeders/wordPackSeeder';
import { seedUsers } from './seeders/userSeeder';

const prisma = new PrismaClient();

async function main() {
    console.log('[Seed] Database seeding started...');

    await seedWordPacks(prisma);
    await seedUsers(prisma);

    console.log('[Seed] Database seeding completed successfully!');
}

main()
    .catch((e) => {
        console.error('[Seed] Error seeding database:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
