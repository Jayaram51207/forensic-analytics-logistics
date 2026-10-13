# Patches

One unified diff per existing application file that was modified, produced with `git diff original-suite -- <file>`.
Apply in reverse (`git apply -R <file>.diff`) to return a file to the state in which the suite was received.
New files (`forensics/`, `EasyQuote/ForensicOutbox.cs`, `3D_stuffing_visualizer/src/forensicPayload.js`) are not listed here.
