"""Unit tests for the Atlas table conventions in build_atlas.py (python3 -m unittest discover -s scripts)."""
import unittest

from build_atlas import PERIODS, age_range, ll, nice_name, num


class AtlasConventions(unittest.TestCase):
    def test_sentinel_becomes_none(self):
        self.assertIsNone(num(9999))
        self.assertIsNone(num(None))
        self.assertIsNone(ll(9999, 9999))
        self.assertEqual(age_range(9999, 9999), (None, None))

    def test_ages_sorted_young_old(self):
        self.assertEqual(age_range(50, 35), ([35.0, 50.0], None))   # India top: "Min" column holds the older age
        self.assertEqual(age_range(10, 0.5), ([0.5, 10.0], None))   # Zagros top
        self.assertEqual(age_range(120, 140), ([120.0, 140.0], None))

    def test_periods_use_ics_span(self):
        self.assertEqual(age_range("Triassic", "Triassic"), (list(PERIODS["Triassic"]), "Triassic"))
        self.assertEqual(age_range("Lower_Cretaceous", "Lower_Cretaceous")[0], [100.5, 145.0])
        with self.assertRaises(SystemExit):
            age_range("Triassic", 120)

    def test_coordinates_checked(self):
        self.assertEqual(ll(-175, 52), [-175.0, 52.0])
        with self.assertRaises(SystemExit):
            ll(200, 10)

    def test_names(self):
        self.assertEqual(nice_name("AlJawf"), "Al Jawf")
        self.assertEqual(nice_name("JuandeFuca"), "Juan de Fuca")
        self.assertEqual(nice_name("Aeg-WestAnatolia"), "Aegean-West Anatolia")


if __name__ == "__main__":
    unittest.main()
