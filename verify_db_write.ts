import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    console.log("Testing DB write...");
    try {
        const count = await prisma.company.count();
        console.log("Current count:", count);

        const newCompany = await prisma.company.create({
            data: {
                name: "Test Company DB Verify",
                company_id: "TEST_VERIFY_1",
                location_id: "TEST_VERIFY_1_L1",
                location_name: "Test Location",
                shipping_country: "US"
            }
        });
        console.log("Created company:", newCompany.id);

        const newCount = await prisma.company.count();
        console.log("New count:", newCount);
    } catch (e) {
        console.error("Error:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
