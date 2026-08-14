import { Redirect } from "expo-router";

/** Compatibility route for bookmarks created before the live service shipped. */
export default function CountryLinqaLegacyFlowRedirect() {
  return <Redirect href="/countrylinqa/world" />;
}
