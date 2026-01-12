import { Page, Layout, Card, BlockStack, Text, InlineStack, Button, CalloutCard, Box, Icon } from "@shopify/polaris";
import { useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import type { LoaderFunctionArgs } from "react-router";
import {
  ImportIcon,
  ExportIcon,
  DeliveryIcon,
  CollectionIcon,
  DiscountIcon,
  ArrowRightIcon
} from "@shopify/polaris-icons";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  const navigate = useNavigate();

  return (
    <Page title="Dashboard">
      <Layout>
        <Layout.Section>
          <Card>
            <InlineStack align="space-between" blockAlign="center" gap="400">
              <div style={{ flex: 1 }}>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Welcome to Import/Export Manager</Text>
                  <p>
                    Streamline your store management by bulk importing and exporting data.
                    Manage Companies, Collections, and Discounts with ease using our powerful CSV tools.
                  </p>
                </BlockStack>
              </div>
              <img
                src="https://cdn.shopify.com/s/assets/admin/checkout/settings-customizecart-705f57c725ac05be5a34ec20c05b94298cb8afd10aac7bd9c7ad02030f48cfa0.svg"
                alt="Welcome illustration"
                style={{ width: '150px', height: 'auto' }}
              />
            </InlineStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="500">
            <Text as="h2" variant="headingLg">Quick Actions</Text>
            <InlineStack gap="400" align="start">

              {/* Companies Card */}
              <div style={{ flex: 1, minWidth: '300px' }}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <div style={{
                        background: 'var(--p-color-bg-surface-success)',
                        padding: '10px',
                        borderRadius: '8px'
                      }}>
                        <Icon source={DeliveryIcon} tone="base" />
                      </div>
                    </InlineStack>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">Companies</Text>
                      <Text as="p" tone="subdued">
                        Manage B2B companies, sync locations, and handle customer assignments.
                      </Text>
                    </BlockStack>
                    <Button
                      variant="primary"
                      onClick={() => navigate("/app/companies")}
                      icon={ArrowRightIcon}
                    >
                      Manage Companies
                    </Button>
                  </BlockStack>
                </Card>
              </div>

              {/* Collections Card */}
              <div style={{ flex: 1, minWidth: '300px' }}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <div style={{
                        background: 'var(--p-color-bg-surface-info)',
                        padding: '10px',
                        borderRadius: '8px'
                      }}>
                        <Icon source={CollectionIcon} tone="base" />
                      </div>
                    </InlineStack>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">Collections</Text>
                      <Text as="p" tone="subdued">
                        Import and export smart & manual collections with ease.
                      </Text>
                    </BlockStack>
                    <Button
                      variant="primary"
                      onClick={() => navigate("/app/collections")}
                      icon={ArrowRightIcon}
                    >
                      Manage Collections
                    </Button>
                  </BlockStack>
                </Card>
              </div>

              {/* Discounts Card */}
              <div style={{ flex: 1, minWidth: '300px' }}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <div style={{
                        background: 'var(--p-color-bg-surface-warning)',
                        padding: '10px',
                        borderRadius: '8px'
                      }}>
                        <Icon source={DiscountIcon} tone="base" />
                      </div>
                    </InlineStack>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">Discounts</Text>
                      <Text as="p" tone="subdued">
                        Bulk create discount codes and automatic discounts.
                      </Text>
                    </BlockStack>
                    <Button
                      variant="primary"
                      onClick={() => navigate("/app/discounts")}
                      icon={ArrowRightIcon}
                    >
                      Manage Discounts
                    </Button>
                  </BlockStack>
                </Card>
              </div>

              {/* Metaobjects Card */}
              <div style={{ flex: 1, minWidth: '300px' }}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <div style={{
                        background: 'var(--p-color-bg-surface-magic)',
                        padding: '10px',
                        borderRadius: '8px'
                      }}>
                        <Icon source={CollectionIcon} tone="base" />
                      </div>
                    </InlineStack>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">Metaobjects</Text>
                      <Text as="p" tone="subdued">
                        Import and export Metaobjects with dynamic field support.
                      </Text>
                    </BlockStack>
                    <Button
                      variant="primary"
                      onClick={() => navigate("/app/metaobjects")}
                      icon={ArrowRightIcon}
                    >
                      Manage Metaobjects
                    </Button>
                  </BlockStack>
                </Card>
              </div>

            </InlineStack>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">How it works</Text>
              <InlineStack gap="800" align="start" blockAlign="start">
                <BlockStack gap="200" inlineAlign="start">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ background: 'var(--p-color-bg-fill-brand)', color: 'white', width: '24px', height: '24px', borderRadius: '50%', textAlign: 'center', lineHeight: '24px', fontWeight: 'bold' }}>1</div>
                    <Text as="span" fontWeight="bold">Prepare CSV</Text>
                  </div>
                  <Text as="p" tone="subdued">Create a CSV file with your data.</Text>
                </BlockStack>

                <BlockStack gap="200" inlineAlign="start">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ background: 'var(--p-color-bg-fill-brand)', color: 'white', width: '24px', height: '24px', borderRadius: '50%', textAlign: 'center', lineHeight: '24px', fontWeight: 'bold' }}>2</div>
                    <Text as="span" fontWeight="bold">Import</Text>
                  </div>
                  <Text as="p" tone="subdued">Upload via the dashboard.</Text>
                </BlockStack>

                <BlockStack gap="200" inlineAlign="start">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ background: 'var(--p-color-bg-fill-brand)', color: 'white', width: '24px', height: '24px', borderRadius: '50%', textAlign: 'center', lineHeight: '24px', fontWeight: 'bold' }}>3</div>
                    <Text as="span" fontWeight="bold">Sync</Text>
                  </div>
                  <Text as="p" tone="subdued">Data syncs to Shopify instantly.</Text>
                </BlockStack>
                <BlockStack gap="200" inlineAlign="start">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ background: 'var(--p-color-bg-fill-brand)', color: 'white', width: '24px', height: '24px', borderRadius: '50%', textAlign: 'center', lineHeight: '24px', fontWeight: 'bold' }}>4</div>
                    <Text as="span" fontWeight="bold">Export</Text>
                  </div>
                  <Text as="p" tone="subdued">Export(Download) data to CSV.</Text>
                </BlockStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
