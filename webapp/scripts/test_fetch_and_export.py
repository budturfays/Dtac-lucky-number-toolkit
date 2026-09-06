import unittest
from fetch_and_export import parse_numbering, ensure_pool_health


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


if __name__ == "__main__":
    unittest.main()
