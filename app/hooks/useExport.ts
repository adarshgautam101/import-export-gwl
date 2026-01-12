import { useState } from 'react';

export function useExport(url: string) {
    const [isExporting, setIsExporting] = useState(false);
    const [exportStatus, setExportStatus] = useState<string | null>(null);
    const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

    const handleExport = async (format: 'csv' | 'json' = 'csv', queryParams?: Record<string, string>) => {
        setIsExporting(true);
        setExportStatus("Fetching data from Shopify and preparing export...");
        setDownloadUrl(null);

        try {
            const params = new URLSearchParams({ format, ...queryParams });
            const exportUrl = `${url}?${params.toString()}`;
            const response = await fetch(exportUrl);

            if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);

            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            setDownloadUrl(blobUrl);
            setExportStatus("Export ready for download.");
        } catch (error) {
            console.error('Export failed:', error);
            setExportStatus("Export failed. Please try again.");
        } finally {
            setIsExporting(false);
        }
    };

    const resetExport = () => {
        setExportStatus(null);
        setDownloadUrl(null);
        setIsExporting(false);
    };

    return {
        isExporting,
        exportStatus,
        downloadUrl,
        handleExport,
        resetExport
    };
}
