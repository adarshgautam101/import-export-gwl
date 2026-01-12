import { importCompanies } from "./app/models/company.server.js";

// Mock Admin API
const mockAdmin = {
    graphql: async (query, variables) => {
        console.log(`\n--- GraphQL Query ---`);
        console.log(query.split('(')[0].trim());
        console.log(`Variables:`, JSON.stringify(variables, null, 2));

        // Mock responses based on query
        if (query.includes('query($query: String!) { companies')) {
            return { json: async () => ({ data: { companies: { nodes: [] } } }) };
        }
        if (query.includes('mutation companyCreate')) {
            return {
                json: async () => ({
                    data: {
                        companyCreate: {
                            company: {
                                id: `gid://shopify/Company/${Math.floor(Math.random() * 1000)}`,
                                name: variables.input.company.name,
                                locations: { nodes: [{ id: `gid://shopify/CompanyLocation/${Math.floor(Math.random() * 1000)}` }] }
                            },
                            userErrors: []
                        }
                    }
                })
            };
        }
        if (query.includes('mutation companyLocationCreate')) {
            return {
                json: async () => ({
                    data: {
                        companyLocationCreate: {
                            companyLocation: { id: `gid://shopify/CompanyLocation/${Math.floor(Math.random() * 1000)}` },
                            userErrors: []
                        }
                    }
                })
            };
        }
        if (query.includes('query($type: String!, $query: String) { metaobjects')) {
            return { json: async () => ({ data: { metaobjects: { nodes: [] } } }) };
        }
        if (query.includes('mutation CreateMetaobject')) {
            return { json: async () => ({ data: { metaobjectCreate: { metaobject: { id: 'gid://shopify/Metaobject/1' }, userErrors: [] } } }) };
        }
        if (query.includes('metaobjectDefinitionByType')) {
            return { json: async () => ({ data: { metaobjectDefinitionByType: { id: 'def1' } } }) };
        }

        return { json: async () => ({ data: {} }) };
    }
};

const testData = [
    {
        company_id: 'CMP-TEST-001',
        name: 'Test Company A',
        location_id: 'LOC-A1',
        location_name: 'Headquarters',
        contact_email: 'test-a@example.com',
        shipping_street: '123 Main St'
    },
    {
        company_id: 'CMP-TEST-001',
        name: 'Test Company A',
        location_id: 'LOC-A2',
        location_name: 'Warehouse',
        contact_email: 'test-a@example.com',
        shipping_street: '456 Side St'
    },
    {
        company_id: 'CMP-TEST-002',
        name: 'Test Company B',
        location_id: 'LOC-B1',
        location_name: 'Main Office',
        contact_email: 'test-b@example.com',
        shipping_street: '101 Market St'
    }
];

async function runTest() {
    console.log("🚀 Starting Verification Test...");
    try {
        const results = await importCompanies(testData, mockAdmin, 'csv');
        console.log("\n✅ Test Completed. Results count:", results.length);
        console.log(JSON.stringify(results, null, 2));
    } catch (e) {
        console.error("❌ Test Failed:", e);
    }
}

runTest();
