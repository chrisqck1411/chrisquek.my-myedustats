# Data

Open data from [data.gov.my](https://data.gov.my), published by the Ministry of Education (MOE) and the
Ministry of Higher Education (MOHE) under the
[Creative Commons Attribution 4.0 licence (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).
MyEduStats is unofficial and is not affiliated with any government agency.

These files are written by the weekly refresh (`.github/workflows/refresh-data.yml`, code in
`scripts/refresh-data.mjs`). Do not edit them by hand.

| File | What it is |
| --- | --- |
| `raw/<dataset id>.json` | One file per dataset: a header (source, licence, "as of" year, last updated, next update, row count) and every row as published, plus `level` (national, state or district), `state_key`, `district_key` and `flags` (`blank`, `over_100`). |
| `places.json` | The register of states and districts, with a permanent key for each and the spelling each dataset uses. A new or renamed place stops the refresh until it is reviewed. |
| `refresh-report.json` | What changed in the last refresh that found changes, with warnings. |

Things to know about the data (found on 23 November 2026):

- The `date` is an "as at" date. Older years use 1 January; from 2023 enrolment and teacher figures use 30 June.
- National rows use the state name `Malaysia`. State totals use the district name `All Districts`.
- District names differ between datasets (district counts: schools 153, enrolment 171, teachers 175, completion 141).
  Names that differ only in punctuation share a key (`Bangsar/Pudu` and `Bangsar Pudu`); nothing else is merged.
- Completion rates can be above 100% and can be blank. They are kept as published and flagged.
- Lecturer figures by state do not add up to the national figure; never present a sum of states as a national figure.
