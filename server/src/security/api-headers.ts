/** JSON API responses do not need executable content, frames or form submissions. */
export const API_CONTENT_SECURITY_POLICY = {
  useDefaults: false,
  directives: {
    defaultSrc: ["'none'"],
    baseUri: ["'none'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    formAction: ["'none'"]
  }
};
