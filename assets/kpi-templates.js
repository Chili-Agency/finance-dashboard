/*
 * GERADO por tools/kpi-templates-from-xlsx.py a partir de Chili_KPI_OKR_Framework_2026_v3.xlsx em 2026-11-16.
 * Não edite à mão: ajuste a planilha (ou as regras do script) e gere de novo.
 * Modelos de KPI por departamento do ClickUp e cargo. Tech ainda não tem modelo.
 */
const KPI_ROLE_TEMPLATES = {
  "source": "Chili_KPI_OKR_Framework_2026_v3.xlsx",
  "generatedAt": "2026-11-16",
  "levelMap": {
    "Intern/Entry": "L0",
    "Analyst/Execution": "L1",
    "Analyst": "L1",
    "Coordinator/Senior": "L2",
    "Senior": "L2",
    "Head/Manager": "L3"
  },
  "departments": {
    "SEO": {
      "roles": [
        {
          "role": "Head of SEO",
          "sheetLevel": "Head/Manager",
          "level": "L3",
          "kpis": [
            {
              "name": "Portfolio Growth QoQ",
              "description": "Increase SEO portfolio value (Upsell/Crossell/Referral)",
              "weight": 35.0,
              "target": 10,
              "unit": "% QoQ",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            },
            {
              "name": "Retention Rate",
              "description": "Retention Rate",
              "weight": 20.0,
              "target": 95,
              "unit": "%",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            },
            {
              "name": "Accounts Hitting Performance",
              "description": "Accounts achieving KPIs (Rankings, DR, Speed, Organic Traffic)",
              "weight": 20.0,
              "target": 80,
              "unit": "% of accounts",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Margin",
              "description": "Efficiency KPI Achievement",
              "weight": 15.0,
              "target": 20,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Team Development",
              "description": "NPS Achievement",
              "weight": 10.0,
              "target": 100,
              "unit": "%",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            }
          ]
        },
        {
          "role": "SEO Account Manager",
          "sheetLevel": "Senior",
          "level": "L2",
          "kpis": [
            {
              "name": "Portfolio Growth QoQ",
              "description": "Increase SEO portfolio value (Upsell/Crossell/Referral)",
              "weight": 30.0,
              "target": 10,
              "unit": "% QoQ",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            },
            {
              "name": "Retention Rate",
              "description": "Retention Rate",
              "weight": 20.0,
              "target": 95,
              "unit": "%",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            },
            {
              "name": "Accounts Hitting Performance",
              "description": "Accounts achieving KPIs (Rankings, DR, Speed, Organic Traffic)",
              "weight": 25.0,
              "target": 80,
              "unit": "% of accounts",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Performance",
              "description": "Team KPI Achievement",
              "weight": 15.0,
              "target": 20,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Team Development",
              "description": "NPS Achievement",
              "weight": 10.0,
              "target": 100,
              "unit": "% QoQ",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            }
          ]
        },
        {
          "role": "SEO Analyst",
          "sheetLevel": "Analyst/Execution",
          "level": "L1",
          "kpis": [
            {
              "name": "Portfolio Growth QoQ",
              "description": "Increase SEO portfolio value (Upsell/Crossell/Referral)",
              "weight": 30.0,
              "target": 10,
              "unit": "% QoQ",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            },
            {
              "name": "Campaign KPI Hit-Rate",
              "description": "Assigned accounts meeting monthly KPIs",
              "weight": 25.0,
              "target": 80,
              "unit": "% of accounts",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Task SLA",
              "description": "% ontime task deliveries",
              "weight": 15.0,
              "target": 95,
              "unit": "%",
              "direction": "higher",
              "source": "ClickUp",
              "autofill": "on_time"
            },
            {
              "name": "Insights Quality",
              "description": "Billable Hours in Time Sheet",
              "weight": 15.0,
              "target": 8,
              "unit": "score (0-10)",
              "direction": "higher",
              "source": "ClickUp",
              "autofill": null
            },
            {
              "name": "Collaboration NPS",
              "description": "NPS Fill Rate",
              "weight": 15.0,
              "target": 8,
              "unit": "score (0-10)",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            }
          ]
        },
        {
          "role": "SEO Intern",
          "sheetLevel": "Intern/Entry",
          "level": "L0",
          "kpis": [
            {
              "name": "Task Completion",
              "description": "Tasks delivered in Allocated time",
              "weight": 30.0,
              "target": 100,
              "unit": "%",
              "direction": "higher",
              "source": "ClickUp",
              "autofill": "on_time"
            },
            {
              "name": "Insights Quality",
              "description": "Time Tracking Accuracy",
              "weight": 20.0,
              "target": 8,
              "unit": "score (0-10)",
              "direction": "higher",
              "source": "ClickUp",
              "autofill": null
            },
            {
              "name": "Rework Rate",
              "description": "Content or on-page changes requested",
              "weight": 15.0,
              "target": 10,
              "unit": "% (lower is better)",
              "direction": "lower",
              "source": "",
              "autofill": null
            },
            {
              "name": "Project Delivery",
              "description": "Achievement of monthly milestone",
              "weight": 20.0,
              "target": 90,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Training Completion",
              "description": "Course Completions",
              "weight": 15.0,
              "target": 100,
              "unit": "%",
              "direction": "higher",
              "source": "Platform",
              "autofill": null
            }
          ]
        }
      ]
    },
    "PPC": {
      "roles": [
        {
          "role": "Head of PPC",
          "sheetLevel": "Head/Manager",
          "level": "L3",
          "kpis": [
            {
              "name": "Portfolio Growth QoQ",
              "description": "Increase PPC portfolio value (Upsell/Crossell/Referral)",
              "weight": 35.0,
              "target": 10,
              "unit": "% QoQ",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            },
            {
              "name": "Retention Rate",
              "description": "Retention Rate",
              "weight": 20.0,
              "target": 95,
              "unit": "%",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            },
            {
              "name": "Accounts Hitting Performance",
              "description": "Accounts achieving ROI goals",
              "weight": 20.0,
              "target": 80,
              "unit": "% of accounts",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Margin",
              "description": "Efficiency KPI Achievement",
              "weight": 15.0,
              "target": 20,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Team Development",
              "description": "NPS Achievement",
              "weight": 10.0,
              "target": 100,
              "unit": "%",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            }
          ]
        },
        {
          "role": "PPC Coordinator",
          "sheetLevel": "Coordinator/Senior",
          "level": "L2",
          "kpis": [
            {
              "name": "Portfolio Growth QoQ",
              "description": "Increase PPC portfolio value (Upsell/Crossell/Referral)",
              "weight": 30.0,
              "target": 10,
              "unit": "% QoQ",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            },
            {
              "name": "Retention Rate",
              "description": "Retention Rate",
              "weight": 20.0,
              "target": 96,
              "unit": "%",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            },
            {
              "name": "Accounts Hitting Performance",
              "description": "Accounts achieving ROi goals",
              "weight": 25.0,
              "target": 80,
              "unit": "% of accounts",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Performance",
              "description": "Team KPI Achievement",
              "weight": 15.0,
              "target": 20,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Team Development",
              "description": "NPS Achievement",
              "weight": 10.0,
              "target": 100,
              "unit": "%",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            }
          ]
        },
        {
          "role": "PPC Analyst",
          "sheetLevel": "Analyst/Execution",
          "level": "L1",
          "kpis": [
            {
              "name": "Portfolio Growth QoQ",
              "description": "Increase PPC portfolio value (Upsell/Crossell/Referral)",
              "weight": 30.0,
              "target": 10,
              "unit": "% QoQ",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            },
            {
              "name": "Campaign KPI Hit-Rate",
              "description": "Assigned accounts meeting monthly KPIs",
              "weight": 25.0,
              "target": 80,
              "unit": "% of accounts",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Task SLA",
              "description": "% ontime task deliveries",
              "weight": 15.0,
              "target": 95,
              "unit": "%",
              "direction": "higher",
              "source": "ClickUp",
              "autofill": "on_time"
            },
            {
              "name": "Insights Quality",
              "description": "Billable Hours in Time Sheet",
              "weight": 15.0,
              "target": 8,
              "unit": "score (0-10)",
              "direction": "higher",
              "source": "ClickUp",
              "autofill": null
            },
            {
              "name": "Collaboration NPS",
              "description": "NPS Fill Rate",
              "weight": 15.0,
              "target": 8,
              "unit": "score (0-10)",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            }
          ]
        },
        {
          "role": "PPC Intern",
          "sheetLevel": "Intern/Entry",
          "level": "L0",
          "kpis": [
            {
              "name": "Task Completion",
              "description": "Tasks delivered in Allocated time",
              "weight": 30.0,
              "target": 100,
              "unit": "%",
              "direction": "higher",
              "source": "ClickUp",
              "autofill": "on_time"
            },
            {
              "name": "Insights Quality",
              "description": "Time Tracking Accuracy",
              "weight": 20.0,
              "target": 8,
              "unit": "score (0-10)",
              "direction": "higher",
              "source": "ClickUp",
              "autofill": null
            },
            {
              "name": "Rework Rate",
              "description": "Budget Pacing and Campaign Setup accuracy",
              "weight": 15.0,
              "target": 10,
              "unit": "% (lower is better)",
              "direction": "lower",
              "source": "",
              "autofill": null
            },
            {
              "name": "Project Delivery",
              "description": "Achievement of monthly milestone",
              "weight": 20.0,
              "target": 90,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Training Completion",
              "description": "Course Completions",
              "weight": 15.0,
              "target": 100,
              "unit": "%",
              "direction": "higher",
              "source": "Platform",
              "autofill": null
            }
          ]
        }
      ]
    },
    "Tech": {
      "roles": []
    },
    "AM": {
      "roles": [
        {
          "role": "Account Manager",
          "sheetLevel": "Analyst",
          "level": "L1",
          "kpis": [
            {
              "name": "Retention Rate",
              "description": "Maintain Monthly Recieved Revenue",
              "weight": 30.0,
              "target": 95,
              "unit": "%",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            },
            {
              "name": "Upsell / Cross-sell Value",
              "description": "Monthly Additional Recieved Revenue",
              "weight": 25.0,
              "target": 10,
              "unit": "%",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            },
            {
              "name": "Client Feedback (NPS)",
              "description": "Avg client rating & fill rate",
              "weight": 15.0,
              "target": 8,
              "unit": "Score (1–10)",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            },
            {
              "name": "Account Health Score",
              "description": "% of green (healthy) accounts",
              "weight": 15.0,
              "target": 85,
              "unit": "%",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            },
            {
              "name": "Reporting Timeliness",
              "description": "Reports delivered on time",
              "weight": 15.0,
              "target": 95,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            }
          ]
        }
      ]
    },
    "Creative": {
      "roles": [
        {
          "role": "Creative Lead",
          "sheetLevel": "Head/Manager",
          "level": "L3",
          "kpis": [
            {
              "name": "Conversion Uplift",
              "description": "Median uplift from CRO tests",
              "weight": 30.0,
              "target": 10,
              "unit": "% uplift",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "SLA Hit-Rate",
              "description": "Asset delivery on time",
              "weight": 20.0,
              "target": 95,
              "unit": "%",
              "direction": "higher",
              "source": "ClickUp",
              "autofill": "on_time"
            },
            {
              "name": "Stakeholder NPS",
              "description": "AM/PPC/SEO satisfaction",
              "weight": 15.0,
              "target": 8,
              "unit": "score (0-10)",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            },
            {
              "name": "Testing Velocity",
              "description": "Experiments launched per month",
              "weight": 20.0,
              "target": 6,
              "unit": "count / month",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "QA/Error Rate",
              "description": "Returned assets needing rework",
              "weight": 15.0,
              "target": 5,
              "unit": "% (lower better)",
              "direction": "lower",
              "source": "",
              "autofill": null
            }
          ]
        },
        {
          "role": "Designer / CRO Specialist",
          "sheetLevel": "Coordinator/Senior",
          "level": "L2",
          "kpis": [
            {
              "name": "On-Time Delivery",
              "description": "Assets delivered by agreed SLA",
              "weight": 25.0,
              "target": 95,
              "unit": "%",
              "direction": "higher",
              "source": "ClickUp",
              "autofill": "on_time"
            },
            {
              "name": "Conversion Impact",
              "description": "Median uplift on owned tests",
              "weight": 25.0,
              "target": 8,
              "unit": "% uplift",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Brief Acceptance Rate",
              "description": "Client approval on first pass",
              "weight": 20.0,
              "target": 90,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Rework Rate",
              "description": "Changes due to QC issues",
              "weight": 15.0,
              "target": 10,
              "unit": "% (lower better)",
              "direction": "lower",
              "source": "",
              "autofill": null
            },
            {
              "name": "Documentation",
              "description": "Test logs & learnings shared",
              "weight": 15.0,
              "target": 100,
              "unit": "%",
              "direction": "higher",
              "source": "Platform",
              "autofill": null
            }
          ]
        },
        {
          "role": "Design Intern",
          "sheetLevel": "Intern/Entry",
          "level": "L0",
          "kpis": [
            {
              "name": "Asset Volume",
              "description": "Assets produced to spec",
              "weight": 30.0,
              "target": 60,
              "unit": "count / month",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Checklists",
              "description": "QC checklist adherence",
              "weight": 25.0,
              "target": 100,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Turnaround",
              "description": "Tasks within SLA",
              "weight": 20.0,
              "target": 95,
              "unit": "%",
              "direction": "higher",
              "source": "ClickUp",
              "autofill": "on_time"
            },
            {
              "name": "Learning Milestones",
              "description": "CRO tooling & design systems",
              "weight": 25.0,
              "target": 100,
              "unit": "%",
              "direction": "higher",
              "source": "Platform",
              "autofill": null
            }
          ]
        }
      ]
    },
    "Sales": {
      "roles": [
        {
          "role": "Head of Sales",
          "sheetLevel": "Head/Manager",
          "level": "L3",
          "kpis": [
            {
              "name": "Portfolio Value Growth QoQ",
              "description": "Increase total sales portfolio value quarter-over-quarter",
              "weight": 30.0,
              "target": 10,
              "unit": "% QoQ",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            },
            {
              "name": "Retention Rate",
              "description": "Maintain client portfolio (revenue retention, not account renewals)",
              "weight": 25.0,
              "target": 95,
              "unit": "%",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            },
            {
              "name": "Contract Margin",
              "description": "Maintain profit margin across portfolio",
              "weight": 20.0,
              "target": 25,
              "unit": "%",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            },
            {
              "name": "Forecast Accuracy (Leadership)",
              "description": "Compare departmental target vs actual at end of quarter",
              "weight": 15.0,
              "target": 90,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Team Capability",
              "description": "Ensure all sales staff complete training and process adoption",
              "weight": 10.0,
              "target": 100,
              "unit": "%",
              "direction": "higher",
              "source": "Platform",
              "autofill": null
            }
          ]
        },
        {
          "role": "Sales Manager",
          "sheetLevel": "Coordinator/Senior",
          "level": "L2",
          "kpis": [
            {
              "name": "Net New Contract Value",
              "description": "Total new signed and paid contracts per month",
              "weight": 30.0,
              "target": 100000,
              "unit": "USD / month",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "LTV/CAC Ratio",
              "description": "Efficiency between lifetime client value and acquisition cost",
              "weight": 20.0,
              "target": 3,
              "unit": "Ratio (x) / Quarter",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Retention Rate (Portfolio)",
              "description": "% of clients retained (value-weighted)",
              "weight": 25.0,
              "target": 95,
              "unit": "% / Quarter",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            },
            {
              "name": "Sales Cycle Time",
              "description": "Average days from SQL to Closed-Won",
              "weight": 15.0,
              "target": 30,
              "unit": "Days / Month",
              "direction": "lower",
              "source": "",
              "autofill": null
            },
            {
              "name": "Average Deal Value",
              "description": "Average contract value per deal closed",
              "weight": 10.0,
              "target": 3000,
              "unit": "USD / Month",
              "direction": "higher",
              "source": "",
              "autofill": null
            }
          ]
        },
        {
          "role": "BDR",
          "sheetLevel": "Analyst",
          "level": "L1",
          "kpis": [
            {
              "name": "Qualified Leads",
              "description": "Total new contract value signed & paid per month",
              "weight": 30.0,
              "target": 75000,
              "unit": "$ / month",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Pipeline Conversion",
              "description": "Closed deals / qualified proposals",
              "weight": 20.0,
              "target": 25,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "CRM Hygiene",
              "description": "Average contract value per deal",
              "weight": 15.0,
              "target": 3000,
              "unit": "$",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Automation Usage",
              "description": "Average days from SQL to Closed-Won",
              "weight": 15.0,
              "target": 30,
              "unit": "days",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Follow-up Cadence",
              "description": "Accuracy of monthly forecast vs actual",
              "weight": 20.0,
              "target": 85,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            }
          ]
        },
        {
          "role": "SDR",
          "sheetLevel": "Analyst",
          "level": "L1",
          "kpis": [
            {
              "name": "Qualified Meetings",
              "description": "Meetings that meet criteria",
              "weight": 30.0,
              "target": 24,
              "unit": "count / month",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Daily Calls",
              "description": "Outbound calls placed",
              "weight": 20.0,
              "target": 100,
              "unit": "calls / day",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "First-Response SLA",
              "description": "Median time to first-touch on new leads",
              "weight": 15.0,
              "target": 10,
              "unit": "minutes",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Show Rate",
              "description": "% of meetings that occur",
              "weight": 15.0,
              "target": 80,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "CRM Hygiene",
              "description": "Leads with complete notes & next steps",
              "weight": 20.0,
              "target": 100,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            }
          ]
        },
        {
          "role": "BDR Intern",
          "sheetLevel": "Intern/Entry",
          "level": "L0",
          "kpis": [
            {
              "name": "Daily Calls",
              "description": "Total new contract value signed & paid per month",
              "weight": 30.0,
              "target": 50000,
              "unit": "$ / month",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Prospect Research",
              "description": "Closed deals / qualified proposals",
              "weight": 20.0,
              "target": 15,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Data Accuracy",
              "description": "Average contract value per deal",
              "weight": 15.0,
              "target": 1200,
              "unit": "$",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Email Deliverability",
              "description": "Average days from SQL to Closed-Won",
              "weight": 15.0,
              "target": 30,
              "unit": "days",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Learning Milestones",
              "description": "Accuracy of monthly forecast vs actual",
              "weight": 20.0,
              "target": 85,
              "unit": "%",
              "direction": "higher",
              "source": "Platform",
              "autofill": null
            }
          ]
        },
        {
          "role": "SDR Intern",
          "sheetLevel": "Intern/Entry",
          "level": "L0",
          "kpis": [
            {
              "name": "Qualified Meetings",
              "description": "Meetings that meet criteria",
              "weight": 30.0,
              "target": 16,
              "unit": "count / month",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Daily Calls",
              "description": "Outbound calls placed",
              "weight": 20.0,
              "target": 75,
              "unit": "calls / day",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "First-Response SLA",
              "description": "Median time to first-touch on new leads",
              "weight": 15.0,
              "target": 5,
              "unit": "minutes",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Show Rate",
              "description": "% of meetings that occur",
              "weight": 15.0,
              "target": 70,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "CRM Hygiene",
              "description": "Leads with complete notes & next steps",
              "weight": 20.0,
              "target": 100,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            }
          ]
        }
      ]
    },
    "Ops": {
      "roles": [
        {
          "role": "CEO (Operations Oversight)",
          "sheetLevel": "Head/Manager",
          "level": "L3",
          "kpis": [
            {
              "name": "Group Margin",
              "description": "Maintain overall company net margin across all departments",
              "weight": 30.0,
              "target": 20,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Operational Efficiency",
              "description": "Ensure <10% of client tasks breach SLA across departments",
              "weight": 20.0,
              "target": 10,
              "unit": "% (lower better)",
              "direction": "lower",
              "source": "",
              "autofill": null
            },
            {
              "name": "Automation Adoption Rate",
              "description": "% of teams actively using automated workflows",
              "weight": 15.0,
              "target": 80,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Rework Reduction",
              "description": "Reduction in rework rate vs last quarter",
              "weight": 15.0,
              "target": 20,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Tooling Cost Ratio",
              "description": "Total software/tooling spend as % of revenue",
              "weight": 10.0,
              "target": 8,
              "unit": "%",
              "direction": "higher",
              "source": "",
              "autofill": null
            },
            {
              "name": "Cross-Department Alignment",
              "description": "NPS from Heads of Department on collaboration & support",
              "weight": 10.0,
              "target": 8,
              "unit": "score (0-10)",
              "direction": "higher",
              "source": "Dashboard",
              "autofill": null
            }
          ]
        }
      ]
    }
  }
};
