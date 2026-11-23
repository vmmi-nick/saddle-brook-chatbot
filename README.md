# Saddle Brook Constituent Chatbot

Bilingual (English/Spanish) constituent chatbot for the Township of
Saddle Brook, NJ, duplicating the North Bergen / Parsippany / Staten Island
chatbot architecture: Node 20 + Express, a verified local index answered
first with whole-word matching, the Meta Model API as backup only, trusted
sources enforced server side, a 911 redirect, and voice (Tap & Talk
dictation plus Listen read-aloud).

## Theme

Saddle Brook's own colors, sampled from the rendered official site
saddlebrooknj.us on 2026-11-22: header vivid royal blue #0202D6, nav bar
bright lemon yellow #FEFE64, headings and footer dark navy #0C2D68 / #00328F.
The bot theme uses navy #0C2D68 as primary and #08204A dark, with the site
yellow deepened to #D9A514 for text contrast (the raw #FEFE64 is too light
to read text on).

## Verified basics (checked 2026-11-22 on saddlebrooknj.us)

- Municipal Complex / Town Hall: 55 Mayhill Street, Saddle Brook, NJ 07663
  (relocated from 93 Market Street), main 201-587-2900, hours Mon to Fri
  8:30 AM to 4:00 PM
- Fallback: Township HELP line 201-587-2912
- Mayor Robert D. White; Council: Andrew Cimiluca (President), Todd J.
  Accomando, David Gierek, Florence Mazzer, Sarah Sanchez. Roster changes
  at the January 2027 reorganization (Garrett Luna won a seat Nov 3, 2026);
  flagged for a January update
- Meetings: work sessions first Thursday 5:30 PM, regular meetings third
  Thursday 7:00 PM, Municipal Complex (2026 schedule, Resolution CR# 0226-45)
- Clerk's Office 201-587-2901 (answers give the office and number, no name:
  the Clerk page and 2026 meeting notices name different people)
- Tax Collector Linda Pellicier 201-587-2914; taxes due Feb 1, May 1,
  Aug 1, Nov 1, 10 day grace period
- Tax Assessor (201) 350-2110 Ext. 2922 (department page number; the site
  Directory lists 201-587-2917 instead, conflict flagged in the Master
  Q&A List)
- Building 201-843-7111; DPW 201-843-3064 (251 2nd Street); Police
  non-emergency 201-843-7000; Court 201-587-2930; Water 201-587-2905;
  Senior Center 201-845-4594 (8 Caldwell Avenue); Library 201-843-3287
- Garbage including bulk items every Wednesday and Saturday township-wide;
  white goods, scrap metal and electronics by appointment through DPW;
  recycling Fridays alternating; yard waste by section Mon to Thu

## Report an issue

Prepare mode only, like North Bergen: the wizard builds a summary and shows
the resident the department number and a Copy button. Nothing is sent or
stored by this page. Saddle Brook has no GovPilot-style intake form.

## Deployment

NOT deployed. GitHub and Render are a separate gate and need Nick's word,
the same as Parsippany. Blueprint in render.yaml (one Starter web service,
saddle-brook-chatbot). Set MODEL_API_KEY in the Render dashboard only;
never commit it.
