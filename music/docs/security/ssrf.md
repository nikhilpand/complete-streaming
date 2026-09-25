# SSRF Prevention & URL Resolution Security

## 1. Threat Profile: URL-Based Lookup

Multiple community JioSaavn APIs provide URL resolution endpoints:

```
GET /song?url=https://www.jiosaavn.com/song/example/token
```

In naive implementations, this is implemented as:

```python
# VULNERABLE PATTERN IN COMMUNITY PROJECTS:
@app.get("/song")
def resolve(url: str):
    return requests.get(url).text  # CRITICAL SSRF
```

An attacker can provide:
- `http://169.254.169.254/latest/meta-data/` (AWS/GCP Cloud Metadata)
- `http://127.0.0.1:6379/` (Internal Redis)
- `http://localhost:8080/admin` (Internal microservices)
- `file:///etc/passwd` or `ftp://`

This enables remote code execution, cloud credential theft, and internal port scanning.

---

## 2. SWAY Multi-Layer SSRF Defense Model

SWAY strictly rejects fetching user-supplied URLs over the network. Instead, it enforces a zero-trust offline validation model:

```
User Input URL
      │
      ▼
[1] Length Guard (<= 2048 chars)
      │
      ▼
[2] Scheme Enforcement (https only)
      │
      ▼
[3] Hostname Allowlist Check
    - www.jiosaavn.com
    - jiosaavn.com
    - saavn.com
    - www.saavn.com
      │
      ▼
[4] IP Format Rejection
    - Disallows raw IP hosts (IPv4 & IPv6)
    - Rejects private/loopback/link-local ranges (RFC 1918, RFC 3927)
      │
      ▼
[5] Strict Path & Token Parsing
    - Regex: ^[A-Za-z0-9_\-]+$
    - Resource type mapped to enum (song, album, playlist, artist)
      │
      ▼
Token Extracted (e.g. "I9DTxvJNRQA_")
      │
      ▼
Network Request dispatched ONLY to official gateway:
https://www.jiosaavn.com/api.php?__call=webapi.get&token=...
(User-supplied URL is NEVER fetched directly)
```

---

## 3. Defense Implementation Details (`SaavnURLResolver`)

### Offline Lexical Validation
`SaavnURLResolver.parse(url)` performs purely in-memory URL analysis. No network socket is opened to the host supplied in the URL.

### Token Extraction Only
The user's URL is treated solely as an input string from which the token slug is extracted. The request made by the provider engine always connects to `settings.SAAVN_BASE_URL` (`https://www.jiosaavn.com/api.php`) with the token as a query parameter.

### Malformed URL Handling
`urllib.parse` exceptions (such as invalid IPv6 bracket notations) are caught and mapped directly to `ProviderInvalidRequest` rather than crashing the server or triggering 500 errors.
