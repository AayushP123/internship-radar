import unittest

from monitor import Job, canonical_url, contains_term, matches


FILTERS = {
    "internship_terms": ["intern", "internship", "co-op", "coop"],
    "role_terms": ["software engineer", "software engineering", "machine learning engineer"],
    "exclude_title_terms": ["senior", "technical support", "hardware"],
    "exclude_location_terms": ["london", "canada"],
    "location_terms": ["united states", "remote", "california", "new york"],
}


class MonitorTests(unittest.TestCase):
    def test_intern_does_not_match_international(self):
        self.assertFalse(contains_term("software engineer, international", "intern"))

    def test_valid_software_internship_matches(self):
        job = Job("test", "Example", "Software Engineer Intern", "California", "https://example.com/job")
        self.assertTrue(matches(job, FILTERS, set()))

    def test_support_internship_is_rejected(self):
        job = Job(
            "test",
            "Example",
            "Technical Support Engineering Intern",
            "United States",
            "https://example.com/job",
        )
        self.assertFalse(matches(job, FILTERS, set()))

    def test_foreign_remote_role_is_rejected(self):
        job = Job("test", "Example", "Software Engineer Intern", "London / Remote", "https://example.com/job")
        self.assertFalse(matches(job, FILTERS, set()))

    def test_tracking_parameters_are_removed_from_fingerprint_url(self):
        self.assertEqual(
            canonical_url("https://example.com/job/1?utm_source=x&job=1#apply"),
            "https://example.com/job/1?job=1",
        )


if __name__ == "__main__":
    unittest.main()
