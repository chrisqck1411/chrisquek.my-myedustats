# MyEduStats

Free, unofficial education statistics for Malaysia, in English and Bahasa Melayu.

MyEduStats turns open government data into maps, charts and plain-language notes, so journalists, researchers, parents and policymakers can see what the numbers say. Teachers are welcome too.

Live site (coming): https://myedustats.chrisquek.my

## Status

Work in progress. This is a ground-up rebuild of the earlier MyEduStats site. It is being built in stages and is not live yet.

## Data

All figures come from open data published on [data.gov.my](https://data.gov.my) under the Creative Commons Attribution 4.0 licence (CC BY 4.0). Each chart on the site names its source, the year the data refers to and any limits of the data.

MyEduStats is not an official government service and is not affiliated with the Ministry of Education, the Department of Statistics Malaysia or any other agency.

## How it works

- A static site built with Astro, with charts and maps drawn by Apache ECharts.
- Data is stored as JSON files in this repository. A scheduled GitHub Action checks data.gov.my for new figures and opens a pull request only when the numbers change.
- Hosted on Cloudflare Pages. The `staging` branch is the test site; `main` is the live site.

## Contact

Feedback: myedustats.feedback@chrisquek.my

## Licence

The data is CC BY 4.0, credited to its publishers. A licence for the code will be added before the site goes live.
