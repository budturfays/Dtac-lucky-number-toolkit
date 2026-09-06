import json
import os
import tempfile
import unittest
from unittest.mock import patch
import export_numbers_json as exporter


class CsvExportTests(unittest.TestCase):
    def test_csv_export_writes_matching_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            source = os.path.join(folder, "all_numbers.csv")
            with open(source, "w", encoding="utf-8") as f:
                f.write("msisdn,price_baht_month,pool(s)\n0803655552,1199,universal\n")
            os.utime(source, (1700000000, 1700000000))
            with patch.object(exporter, "ROOT", folder), patch.object(exporter, "find_csv", return_value=source):
                exporter.main()
            data_dir = os.path.join(folder, "public", "data")
            with open(os.path.join(data_dir, "numbers.json"), encoding="utf-8") as f:
                rows = json.load(f)
            with open(os.path.join(data_dir, "meta.json"), encoding="utf-8") as f:
                meta = json.load(f)
            self.assertEqual(meta["count"], len(rows))
            self.assertEqual(rows[0]["pools"], "universal")
            self.assertEqual(exporter.datetime.fromisoformat(meta["lastmod"]).timestamp(), 1700000000)


if __name__ == "__main__":
    unittest.main()
