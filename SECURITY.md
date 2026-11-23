# Security

Please report vulnerabilities privately, not in a public issue: use **Report a vulnerability** on the Security tab of this repository, or write to office@clouddna.at.

We answer within five working days. Fixes go into the latest version; please update with `npx odatatailor-diff@latest`.

Relevant for this tool: anything that leaks `--header` values (credentials), sends requests to hosts other than the URLs given, or executes content of a `$metadata` document.
