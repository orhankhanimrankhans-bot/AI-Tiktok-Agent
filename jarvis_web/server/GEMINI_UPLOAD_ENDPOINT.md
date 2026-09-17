# Developer API upload-initialization correction

Runtime package: @google/genai 2.20.0. Production SDK source hash matches the
installed test SDK. Constructor remains new GoogleGenAI({ apiKey: key }).
Developer API default version is v1beta.

In SDK fetchUploadUrl, a supplied per-upload httpOptions object replaces its
initialization defaults. COREX supplied timeout/retry settings only, losing
apiVersion: "" and the resumable-start headers. The SDK then prepended v1beta
to its already versioned upload path, producing /v1beta/upload/v1beta/files.

The local correction retains timeout/retry settings and explicitly reproduces
the SDK initialization defaults: empty per-request API prefix and resumable
start headers. Result: /upload/v1beta/files. Model requests still use v1beta.
No dependency, lockfile, media, retry-policy or provider-selection changes.

The actual installed SDK was exercised with fully intercepted fetch and an
inert key. A small synthetic MP4 header fixture tests transport behavior, not
media decoding. The mock rejects the old path with 404 and accepts corrected
initialization/finalization. No live provider upload was performed.

Official endpoint reference: https://ai.google.dev/api/files
