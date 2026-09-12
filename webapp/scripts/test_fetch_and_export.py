import unittest
from unittest.mock import patch
import fetch_and_export as exporter
from fetch_and_export import parse_numbering, parse_ais_response, ensure_pool_health, score_breakdown


class ExportSafetyTests(unittest.TestCase):
    def test_valid_response(self):
        item = {"msisdn": "0803655552", "detail": [{"rc": 399}]}
        self.assertEqual(parse_numbering({"statusCode": 200, "data": {"numbering": [item]}}), [item])

    def test_explicit_empty(self):
        for numbering in (None, []):
            self.assertEqual(parse_numbering({"statusCode": 200, "data": {
                "numbering": numbering, "pagination": {"totalItem": 0}}}), [])

    def test_unknown_is_not_empty(self):
        for response in ({}, {"statusCode": 500}, {"statusCode": 200, "data": {}},
                         {"statusCode": 200, "data": {"numbering": []}},
                         {"statusCode": 200, "data": {"numbering": [{"msisdn": "bad"}]}}):
            with self.assertRaises(ValueError):
                parse_numbering(response)

    def test_missing_price_is_not_free(self):
        with self.assertRaises(ValueError):
            parse_numbering({"statusCode": 200, "data": {"numbering": [{"msisdn": "0803655552"}]}})

    def test_failed_pool_stops_deploy(self):
        for succeeded in (0, 7):
            with self.assertRaises(RuntimeError):
                ensure_pool_health("universal", succeeded, 10)
        ensure_pool_health("universal", 8, 10)

    def test_ais_response_requires_valid_numbers(self):
        rows, total = parse_ais_response({"total_count": 1, "mobile": [{"mobile_no": "0659389235"}]})
        self.assertEqual(total, 1)
        self.assertEqual(rows[0]["mobile_no"], "0659389235")
        for response in ({}, {"total_count": 1},
                         {"total_count": 1, "mobile": [{"mobile_no": "bad"}]}):
            with self.assertRaises(ValueError):
                parse_ais_response(response)

    def test_ais_pages_are_merged_completely(self):
        pages = {
            1: {"total_count": 3, "mobile": [{"mobile_no": "0650000001"}]},
            2: {"total_count": 3, "mobile": [
                {"mobile_no": "0650000002"}, {"mobile_no": "0650000003"}]},
        }
        with patch.object(exporter, "AIS_PAGE_SIZE", 2), \
             patch.object(exporter, "fetch_ais_page", side_effect=lambda page: pages[page]):
            rows = exporter.fetch_all_ais_once()
        self.assertEqual(set(rows), {"0650000001", "0650000002", "0650000003"})
    def test_score_breakdown_keeps_supported_categories(self):
        self.assertEqual(score_breakdown([
            {"name": "การงาน", "star": 5},
            {"name": "การเงิน", "star": 4},
            {"name": "ความรัก", "star": 3},
        ]), {"work": 5, "finance": 4, "love": 3})


if __name__ == "__main__":
    unittest.main()
