var WEBSITE_BLOCK_TYPE = Object.freeze({
  PERMANENT: 0,
  TEMPORARY: 1,
  TIME_BLOCK: 2,
  SCHEDULED: 3
});

var WEBSITE_BLOCK_STATUS = Object.freeze({
  ACTIVE: 0,
  INACTIVE: 1
});

var WEBSITE_BLOCK_SCOPE = Object.freeze({
  DOMAIN: 'domain',
  URL: 'url'
});

// Backward-compatible aliases for existing code and stored references.
var WEBISTE_BLOCK_TYPE = WEBSITE_BLOCK_TYPE;
var WEBISTE_BLOCK_STATUS = WEBSITE_BLOCK_STATUS;
