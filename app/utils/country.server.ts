import countries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";

// Register English locale for country name lookups
countries.registerLocale(enLocale);

export const getCountryCode = (country: string | undefined | null): string | undefined => {
    if (!country) return undefined;

    const normalized = country.trim();

    // If already a 2-letter code, return it uppercase
    if (normalized.length === 2) return normalized.toUpperCase();

    // Use the library to resolve the country name to an ISO 3166-1 alpha-2 code
    return countries.getAlpha2Code(normalized, "en");
};
