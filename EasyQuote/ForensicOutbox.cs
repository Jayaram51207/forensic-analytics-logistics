using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;

namespace Leadking.Forensics
{
    /// <summary>
    /// Evidence outbox shared by EasyQuote, EasyQuoteImport and StuffingReport.
    /// Appends one JSON line per export to %LOCALAPPDATA%\LeadkingForensics\outbox\&lt;application&gt;.jsonl
    /// (or FORENSIC_OUTBOX_DIR). The lines are copied into the hash-chained store by
    /// "node forensics/cli.js ingest". Capture is fail-open: an export never fails because of it.
    /// </summary>
    public static class ForensicOutbox
    {
        private static readonly string SessionId = Guid.NewGuid().ToString();

        public static string Sha256File(string path)
        {
            using var stream = File.OpenRead(path);
            return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
        }

        public static bool Emit(string application, string action, Dictionary<string, object?> payload, string? filePath = null, string? entityType = null)
        {
            try
            {
                string? dir = Environment.GetEnvironmentVariable("FORENSIC_OUTBOX_DIR");
                if (string.IsNullOrEmpty(dir))
                {
                    dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LeadkingForensics", "outbox");
                }
                Directory.CreateDirectory(dir);

                var artifacts = new List<object>();
                if (filePath != null && File.Exists(filePath))
                {
                    artifacts.Add(new { role = "exported_file", path = filePath, sha256 = Sha256File(filePath), size = new FileInfo(filePath).Length });
                }
                payload["session_id"] = SessionId;

                var record = new Dictionary<string, object?>
                {
                    ["source_event_id"] = Guid.NewGuid().ToString(),
                    ["occurred_at"] = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
                    ["application"] = application,
                    ["action"] = action,
                    ["entity_type"] = entityType,
                    // These tools have no shipment reference field; none is invented here.
                    ["shipment_ref"] = null,
                    // Windows account name: a claim, not an authenticated identity.
                    ["actor_claim"] = Environment.UserName,
                    ["actor_source"] = "os_account_claimed",
                    ["artifacts"] = artifacts,
                    ["payload"] = payload
                };
                File.AppendAllText(Path.Combine(dir, application + ".jsonl"), JsonSerializer.Serialize(record) + "\n");
                return true;
            }
            catch
            {
                return false;
            }
        }
    }
}
