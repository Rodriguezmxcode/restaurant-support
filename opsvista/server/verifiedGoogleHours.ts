import type { OperatingSchedule } from '../shared/salaryTiming.js';

// Public Google Business Profile hours read directly in Maps on 2026-09-21 UTC.
// Regular hours only; live GBP specialHours take precedence. Snapshot expires in 7 days.
export const VERIFIED_GOOGLE_HOURS: Record<string, OperatingSchedule> = {
  "Stamford": {
    "timeZone": "America/New_York",
    "source": "Google Maps verified snapshot",
    "verifiedAt": "2026-09-21T01:06:03.092345+00:00",
    "sourceUrl": "https://www.google.com/maps/place/Puerto+Vallarta+Stamford/@41.0514457,-73.537483,17z/data=!3m1!4b1!4m6!3m5!1s0x89c2a1e6b7decf69:0x1baebae088a46f4!8m2!3d41.0514457!4d-73.537483!16s%2Fg%2F11trs47nxn?entry=ttu&g_ep=EgoyMDI2MDkxNi4wIKXMDSoASAFQAw%3D%3D",
    "week": {
      "0": {
        "open": "11:00",
        "close": "22:30"
      },
      "1": {
        "open": "11:00",
        "close": "22:30"
      },
      "2": {
        "open": "11:00",
        "close": "22:30"
      },
      "3": {
        "open": "11:00",
        "close": "22:30"
      },
      "4": {
        "open": "11:00",
        "close": "22:30"
      },
      "5": {
        "open": "11:00",
        "close": "00:00"
      },
      "6": {
        "open": "11:00",
        "close": "00:00"
      }
    }
  },
  "Fairfield": {
    "timeZone": "America/New_York",
    "source": "Google Maps verified snapshot",
    "verifiedAt": "2026-09-21T01:06:03.092345+00:00",
    "sourceUrl": "https://www.google.com/maps/place/Puerto+Vallarta+Fairfield/@41.1813805,-73.2501395,17z/data=!4m7!3m6!1s0x89e80f66ddd95651:0x3a4cfd000ec7e6d2!8m2!3d41.1813805!4d-73.2501395!10e2!16s%2Fg%2F11h_3tc6kl?entry=ttu&g_ep=EgoyMDI2MDkxNi4wIKXMDSoASAFQAw%3D%3D",
    "week": {
      "0": {
        "open": "11:00",
        "close": "00:00"
      },
      "1": {
        "open": "11:00",
        "close": "22:00"
      },
      "2": {
        "open": "11:00",
        "close": "22:00"
      },
      "3": {
        "open": "11:00",
        "close": "22:00"
      },
      "4": {
        "open": "11:00",
        "close": "22:00"
      },
      "5": {
        "open": "11:00",
        "close": "00:00"
      },
      "6": {
        "open": "11:00",
        "close": "00:00"
      }
    }
  },
  "Orange": {
    "timeZone": "America/New_York",
    "source": "Google Maps verified snapshot",
    "verifiedAt": "2026-09-21T01:06:03.092345+00:00",
    "sourceUrl": "https://www.google.com/maps/place/Puerto+Vallarta+-+Orange/@41.2615078,-73.0086572,17z/data=!4m7!3m6!1s0x89e875e9cb1f6bcb:0x21c9472a6aacc093!8m2!3d41.2615078!4d-73.0086572!10e2!16s%2Fg%2F1hc3b3vfd?entry=ttu&g_ep=EgoyMDI2MDkxNi4wIKXMDSoASAFQAw%3D%3D",
    "week": {
      "0": {
        "open": "11:00",
        "close": "00:00"
      },
      "1": {
        "open": "11:00",
        "close": "00:00"
      },
      "2": {
        "open": "11:00",
        "close": "00:00"
      },
      "3": {
        "open": "11:00",
        "close": "00:00"
      },
      "4": {
        "open": "11:00",
        "close": "00:00"
      },
      "5": {
        "open": "11:00",
        "close": "02:00"
      },
      "6": {
        "open": "11:00",
        "close": "02:00"
      }
    }
  },
  "Avon": {
    "timeZone": "America/New_York",
    "source": "Google Maps verified snapshot",
    "verifiedAt": "2026-09-21T01:06:03.092345+00:00",
    "sourceUrl": "https://www.google.com/maps/place/Puerto+Vallarta/@41.815871,-72.86778,17z/data=!4m7!3m6!1s0x89e7a8c46ee86505:0xbb69843ab3363752!8m2!3d41.815871!4d-72.86778!10e2!16s%2Fg%2F1tff8n0p?entry=ttu&g_ep=EgoyMDI2MDkxNi4wIKXMDSoASAFQAw%3D%3D",
    "week": {
      "0": {
        "open": "11:00",
        "close": "22:00"
      },
      "1": {
        "open": "11:00",
        "close": "22:00"
      },
      "2": {
        "open": "11:00",
        "close": "22:00"
      },
      "3": {
        "open": "11:00",
        "close": "22:00"
      },
      "4": {
        "open": "11:00",
        "close": "22:00"
      },
      "5": {
        "open": "11:00",
        "close": "23:00"
      },
      "6": {
        "open": "11:00",
        "close": "23:00"
      }
    }
  },
  "Southington": {
    "timeZone": "America/New_York",
    "source": "Google Maps verified snapshot",
    "verifiedAt": "2026-09-21T01:06:03.092345+00:00",
    "sourceUrl": "https://www.google.com/maps/place/Puerto+Vallarta+Southington+%7C+Mexican/@41.6390018,-72.8748786,17z/data=!4m7!3m6!1s0x89e7b737f206ca6d:0xc7752658c6abf84c!8m2!3d41.6390018!4d-72.8748786!10e2!16s%2Fg%2F1v1vf6qc?entry=ttu&g_ep=EgoyMDI2MDkxNi4wIKXMDSoASAFQAw%3D%3D",
    "week": {
      "0": {
        "open": "11:00",
        "close": "22:30"
      },
      "1": {
        "open": "11:00",
        "close": "22:30"
      },
      "2": {
        "open": "11:00",
        "close": "22:30"
      },
      "3": {
        "open": "11:00",
        "close": "22:30"
      },
      "4": {
        "open": "11:00",
        "close": "22:30"
      },
      "5": {
        "open": "11:00",
        "close": "23:00"
      },
      "6": {
        "open": "11:00",
        "close": "23:00"
      }
    }
  },
  "Danbury": {
    "timeZone": "America/New_York",
    "source": "Google Maps verified snapshot",
    "verifiedAt": "2026-09-21T01:06:03.092345+00:00",
    "sourceUrl": "https://www.google.com/maps/place/Puerto+Vallarta+Danbury/@41.4109499,-73.4130343,17z/data=!4m7!3m6!1s0x89e7fed727e75fc1:0x859831c8076bac55!8m2!3d41.4109499!4d-73.4130343!10e2!16s%2Fg%2F11c20q8xgt?entry=ttu&g_ep=EgoyMDI2MDkxNi4wIKXMDSoASAFQAw%3D%3D",
    "week": {
      "0": {
        "open": "11:00",
        "close": "00:00"
      },
      "1": {
        "open": "11:00",
        "close": "00:00"
      },
      "2": {
        "open": "11:00",
        "close": "00:00"
      },
      "3": {
        "open": "11:00",
        "close": "00:00"
      },
      "4": {
        "open": "11:00",
        "close": "00:00"
      },
      "5": {
        "open": "11:00",
        "close": "02:00"
      },
      "6": {
        "open": "11:00",
        "close": "02:00"
      }
    }
  },
  "Middletown": {
    "timeZone": "America/New_York",
    "source": "Google Maps verified snapshot",
    "verifiedAt": "2026-09-21T01:06:03.092345+00:00",
    "sourceUrl": "https://www.google.com/maps/place/Puerto+Vallarta+Middletown/@41.5594576,-72.648233,17z/data=!3m1!4b1!4m6!3m5!1s0x89e64a439aca6041:0x93831e5ec3e72fb2!8m2!3d41.5594576!4d-72.648233!16s%2Fg%2F1tf08pj0?entry=ttu&g_ep=EgoyMDI2MDkxNi4wIKXMDSoASAFQAw%3D%3D",
    "week": {
      "0": {
        "open": "11:00",
        "close": "21:30"
      },
      "1": {
        "open": "11:00",
        "close": "22:00"
      },
      "2": {
        "open": "11:00",
        "close": "22:00"
      },
      "3": {
        "open": "11:00",
        "close": "22:00"
      },
      "4": {
        "open": "11:00",
        "close": "22:00"
      },
      "5": {
        "open": "11:00",
        "close": "23:00"
      },
      "6": {
        "open": "11:00",
        "close": "23:00"
      }
    }
  },
  "Newington": {
    "timeZone": "America/New_York",
    "source": "Google Maps verified snapshot",
    "verifiedAt": "2026-09-21T01:06:03.092345+00:00",
    "sourceUrl": "https://www.google.com/maps/place/Puerto+Vallarta+Newington/@41.6868387,-72.7087855,17z/data=!3m1!4b1!4m6!3m5!1s0x89e64d4b5988ef01:0x9280a6f98b03a0df!8m2!3d41.6868387!4d-72.7087855!16s%2Fg%2F1td7pbgr?entry=ttu&g_ep=EgoyMDI2MDkxNi4wIKXMDSoASAFQAw%3D%3D",
    "week": {
      "0": {
        "open": "11:00",
        "close": "23:00"
      },
      "1": {
        "open": "11:00",
        "close": "23:00"
      },
      "2": {
        "open": "11:00",
        "close": "23:00"
      },
      "3": {
        "open": "11:00",
        "close": "23:00"
      },
      "4": {
        "open": "11:00",
        "close": "23:00"
      },
      "5": {
        "open": "11:00",
        "close": "23:00"
      },
      "6": {
        "open": "11:00",
        "close": "23:00"
      }
    }
  }
};
