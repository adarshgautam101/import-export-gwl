import { Page, Layout, Card, BlockStack, Spinner, Text, Banner, Button, InlineStack } from "@shopify/polaris";
import { useNavigation } from "react-router";
import { ArrowDownIcon } from "@shopify/polaris-icons";

interface GenericPageProps {
    title: string;
    subtitle?: string;
    primaryAction?: any;
    secondaryActions?: any[];
    children: React.ReactNode;
    loadingTitle?: string;
    loadingText?: string;
    exportStatus?: string | null;
    downloadUrl?: string | null;
    onDismissExport?: () => void;
    entityNameForExport?: string;
}

export function GenericPage({
    title,
    subtitle,
    primaryAction,
    secondaryActions,
    children,
    loadingTitle = "Loading",
    loadingText = "Loading...",
    exportStatus,
    downloadUrl,
    onDismissExport,
    entityNameForExport = "export"
}: GenericPageProps) {
    const navigation = useNavigation();

    return (
        <Page
            fullWidth
            title={title}
            subtitle={subtitle}
        >
            <div style={{ position: 'absolute', top: '0', right: '0', padding: '16px', zIndex: 1 }}>
                <InlineStack gap="200" align="end">
                    {secondaryActions?.map((action, index) => (
                        <Button
                            key={index}
                            onClick={action.onAction}
                            icon={action.icon}
                            disabled={action.disabled}
                            loading={action.loading}
                        >
                            {action.content}
                        </Button>
                    ))}
                    {primaryAction && (
                        <Button
                            variant="primary"
                            onClick={primaryAction.onAction}
                            icon={primaryAction.icon}
                            disabled={primaryAction.disabled}
                            loading={primaryAction.loading}
                        >
                            {primaryAction.content}
                        </Button>
                    )}
                </InlineStack>
            </div>
            <Layout>
                {/* Export Status & Download Banner */}
                {(exportStatus || downloadUrl) && onDismissExport && (
                    <Layout.Section>
                        <Banner
                            title={downloadUrl ? "Export Ready" : "Exporting Data"}
                            tone={downloadUrl ? "success" : exportStatus?.includes("failed") ? "critical" : "info"}
                            onDismiss={onDismissExport}
                        >
                            <BlockStack gap="200">
                                <Text as="p">{exportStatus}</Text>
                                {downloadUrl && (
                                    <Button
                                        url={downloadUrl}
                                        download={`${entityNameForExport}-${new Date().toISOString().split('T')[0]}.csv`}
                                        variant="primary"
                                        icon={ArrowDownIcon}
                                    >
                                        Download CSV
                                    </Button>
                                )}
                            </BlockStack>
                        </Banner>
                    </Layout.Section>
                )}

                {children}
            </Layout>
        </Page>
    );
}
