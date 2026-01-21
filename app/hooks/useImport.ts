import { useState, useCallback, useRef, useEffect } from 'react';

export interface ImportResult {
    message: string;
    successCount: number;
    errorCount: number;
    companyCount?: number; // For company imports, distinct from location count
    syncedCount?: number;
    results?: {
        title: string;
        status: 'success' | 'error' | 'warning';
        message: string;
    }[];
}

interface JobStatusResponse {
    jobId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    successCount: number;
    errorCount: number;
    companyCount?: number;
    results: any[];
    message?: string;
}

// Simple robust CSV parser for browser
const parseCSV = (text: string) => {
    const lines: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let insideQuotes = false;

    // Detect delimiter (comma or tab)
    const firstLine = text.split('\n')[0];
    const delimiter = firstLine.includes('\t') ? '\t' : ',';

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
            if (insideQuotes && nextChar === '"') {
                currentField += '"';
                i++; // Skip escaped quote
            } else {
                insideQuotes = !insideQuotes;
            }
        } else if (char === delimiter && !insideQuotes) {
            currentRow.push(currentField);
            currentField = '';
        } else if ((char === '\n' || char === '\r') && !insideQuotes) {
            if (char === '\r' && nextChar === '\n') i++; // Handle CRLF
            currentRow.push(currentField);
            lines.push(currentRow);
            currentRow = [];
            currentField = '';
        } else {
            currentField += char;
        }
    }
    if (currentField || currentRow.length > 0) {
        currentRow.push(currentField);
        lines.push(currentRow);
    }

    // Convert to objects
    const headers = lines[0].map(h => h.trim());
    return lines.slice(1).map(line => {
        const obj: any = {};
        // Pad line if it has fewer columns than headers
        const paddedLine = [...line];
        while (paddedLine.length < headers.length) {
            paddedLine.push('');
        }
        headers.forEach((h, i) => obj[h] = paddedLine[i]?.trim() || '');
        return obj;
    }).filter(obj => Object.values(obj).some(v => v !== '')); // Filter out completely empty rows
};

export function useImport(url: string, entityType: string) {
    const [isImporting, setIsImporting] = useState(false);
    const [importProgress, setImportProgress] = useState(0);
    const [importResults, setImportResults] = useState<ImportResult | null>(null);
    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const [jobMetadata, setJobMetadata] = useState<any>(null);
    const pollingInterval = useRef<NodeJS.Timeout | null>(null);

    const stopPolling = useCallback(() => {
        if (pollingInterval.current) {
            clearInterval(pollingInterval.current);
            pollingInterval.current = null;
        }
    }, []);

    const clearJob = useCallback(() => {
        stopPolling();
        setActiveJobId(null);
        setJobMetadata(null);
        localStorage.removeItem(`import_job_${entityType}`);
        setIsImporting(false);
    }, [entityType, stopPolling]);

    const startPolling = useCallback((jobId: string) => {
        stopPolling();
        pollingInterval.current = setInterval(async () => {
            try {
                const response = await fetch(`${url}?jobId=${jobId}`);
                if (!response.ok) {
                    if (response.status === 404) {
                        // Job not found (maybe server restarted), clear it
                        clearJob();
                        return;
                    }
                    throw new Error('Failed to fetch job status');
                }

                const data: JobStatusResponse = await response.json();

                // Calculate progress based on processed records vs total
                // The backend might send progress percentage directly or we calculate it
                setImportProgress(data.progress || 0);

                if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
                    setImportResults({
                        message: data.message || `Import ${data.status}`,
                        successCount: data.successCount,
                        errorCount: data.errorCount,
                        companyCount: data.companyCount,
                        results: data.results
                    });
                    clearJob();
                }
            } catch (error) {
                console.error('Polling error:', error);
                // Don't stop polling on transient errors, but maybe stop after too many failures?
                // For now, keep polling.
            }
        }, 2000); // Poll every 2 seconds
    }, [url, clearJob, stopPolling]);

    // Load active job from local storage on mount
    useEffect(() => {
        const storedJob = localStorage.getItem(`import_job_${entityType}`);
        if (storedJob) {
            const { jobId, metadata } = JSON.parse(storedJob);
            if (jobId) {

                setActiveJobId(jobId);
                if (metadata) setJobMetadata(metadata);
                setIsImporting(true);
                startPolling(jobId);
            }
        }
        return () => stopPolling();
    }, [entityType, startPolling, stopPolling]);



    const cancelImport = useCallback(async () => {
        if (!activeJobId) return;

        try {
            // Send cancellation request
            const formData = new FormData();
            formData.append('action', 'cancel');
            formData.append('jobId', activeJobId);

            await fetch(url, {
                method: 'POST',
                body: formData
            });

            // The polling loop will pick up the 'cancelled' status and clean up
        } catch (error) {
            console.error('Failed to cancel import:', error);
        }
    }, [activeJobId, url]);

    const resetImport = useCallback(() => {
        clearJob();
        setImportProgress(0);
        setImportResults(null);
    }, [clearJob]);

    const handleImport = useCallback(async (formData: FormData, metadata?: any) => {
        setIsImporting(true);
        setImportProgress(0);
        setImportResults(null);

        try {
            const file = formData.get('csvFile') as File;
            if (!file) throw new Error('No file selected');

            const text = await file.text();
            const records = parseCSV(text);

            // Extract other fields from FormData
            const extraFields: Record<string, any> = {};
            formData.forEach((value, key) => {
                if (key !== 'csvFile') {
                    extraFields[key] = value;
                }
            });

            // Send records to start job
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'start',
                    records,
                    ...extraFields
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to start import: ${errorText}`);
            }

            const data = await response.json();
            if (data.jobId) {
                setActiveJobId(data.jobId);
                if (metadata) setJobMetadata(metadata);
                localStorage.setItem(`import_job_${entityType}`, JSON.stringify({ jobId: data.jobId, metadata }));
                startPolling(data.jobId);
            } else {
                throw new Error('No job ID returned from server');
            }

        } catch (error: any) {
            setImportResults({
                message: error.message || 'Import failed to start',
                successCount: 0,
                errorCount: 0,
                results: [{ title: 'Start Error', status: 'error', message: error.message }]
            });
            setIsImporting(false);
        }
    }, [url, entityType, startPolling]);

    return {
        isImporting,
        importProgress,
        importResults,
        handleImport,
        resetImport,
        cancelImport,
        jobMetadata
    };
}
