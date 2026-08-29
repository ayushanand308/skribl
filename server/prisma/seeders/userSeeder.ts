import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

export async function seedUsers(prisma: PrismaClient) {
    console.log('[UserSeeder] Seeding default test users...');

    const defaultPasswordHash = await bcrypt.hash('pass123', 10);

    const testUsers = [
        {
            id: 'demo_acc1',
            username: 'acc1',
            email: 'acc1@example.com',
        },
        {
            id: 'demo_acc2',
            username: 'acc2',
            email: 'acc2@example.com',
        },
        {
            id: 'demo_acc3',
            username: 'acc3',
            email: 'acc3@example.com',
        },
    ];

    for (const u of testUsers) {
        await prisma.user.upsert({
            where: { id: u.id },
            update: {},
            create: {
                id: u.id,
                username: u.username,
                email: u.email,
                passwordHash: defaultPasswordHash,
            },
        });
    }

    console.log(`[UserSeeder] Seeded ${testUsers.length} test user accounts.`);
}
