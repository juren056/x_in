using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

class AuditHost {
  static JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
  static void Main() {
    try {
      var input = Console.OpenStandardInput();
      var header = new byte[4];
      if (ReadFull(input, header, 4) != 4) return;
      int length = BitConverter.ToInt32(header, 0);
      if (length < 1 || length > 20 * 1024 * 1024) throw new Exception("Invalid message length");
      var bytes = new byte[length];
      if (ReadFull(input, bytes, length) != length) throw new Exception("Incomplete message");
      var request = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(bytes));
      string action = Convert.ToString(request["action"]);
      string path = request.ContainsKey("path") ? Convert.ToString(request["path"]) : "";
      if (String.IsNullOrWhiteSpace(path)) path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "XFollowAudit");
      if (!Path.IsPathRooted(path)) throw new Exception("Please enter an absolute folder path");
      path = Path.GetFullPath(path);
      if (action == "info") { Respond(new { ok = true, path = path, file = Path.Combine(path, "misclassifications.json") }); return; }
      if (action == "read") {
        string existing = Path.Combine(path, "misclassifications.json");
        object content = File.Exists(existing) ? Json.DeserializeObject(File.ReadAllText(existing, Encoding.UTF8)) : null;
        Respond(new { ok = true, path = path, file = existing, data = content });
        return;
      }
      Directory.CreateDirectory(path);
      if (action != "save" && action != "export") throw new Exception("Unsupported action");
      if (!request.ContainsKey("data")) throw new Exception("Missing data");
      string filename = action == "save" ? "misclassifications.json" :
        "classifier-feedback-" + DateTime.UtcNow.ToString("yyyy-MM-dd-HHmmss-fff") + ".json";
      string target = Path.Combine(path, filename);
      string temp = target + "." + Guid.NewGuid().ToString("N") + ".tmp";
      string data = Json.Serialize(request["data"]);
      try {
        File.WriteAllText(temp, data, new UTF8Encoding(false));
        if (File.Exists(target)) File.Replace(temp, target, null);
        else File.Move(temp, target);
      } finally {
        if (File.Exists(temp)) File.Delete(temp);
      }
      Respond(new { ok = true, path = path, file = target, savedAt = DateTime.UtcNow.ToString("o") });
    } catch (Exception error) {
      Respond(new { ok = false, error = error.Message });
    }
  }
  static int ReadFull(Stream stream, byte[] bytes, int count) {
    int offset = 0;
    while (offset < count) {
      int read = stream.Read(bytes, offset, count - offset);
      if (read <= 0) break;
      offset += read;
    }
    return offset;
  }
  static void Respond(object value) {
    byte[] bytes = Encoding.UTF8.GetBytes(Json.Serialize(value));
    var output = Console.OpenStandardOutput();
    byte[] header = BitConverter.GetBytes(bytes.Length);
    output.Write(header, 0, header.Length);
    output.Write(bytes, 0, bytes.Length);
    output.Flush();
  }
}
