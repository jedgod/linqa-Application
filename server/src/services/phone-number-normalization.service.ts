import { parsePhoneNumberFromString } from "libphonenumber-js";

export class PhoneNumberNormalizationService {
  normalize(raw: string, defaultCountry?: string) {
    const phone = parsePhoneNumberFromString(raw, defaultCountry as never);

    if (!phone || !phone.isPossible()) {
      throw new Error("invalid_or_impossible_phone_number");
    }

    if (!phone.isValid()) {
      throw new Error("invalid_phone_number");
    }

    return {
      e164: phone.number,
      countryIso2: phone.country ?? "ZZ",
      nationalNumberSuffix: phone.nationalNumber.slice(-4)
    };
  }
}
