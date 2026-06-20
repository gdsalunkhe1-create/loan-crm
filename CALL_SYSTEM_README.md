# 📞 Call System - Complete Implementation Guide

## Overview

A comprehensive call management system has been integrated into your CRM with the following features:

✅ Call buttons next to phone numbers everywhere
✅ Floating call timer bar (visible on all pages)
✅ Detailed call form with loan-specific fields
✅ Call history tracking
✅ Analytics dashboard for managers/admins
✅ Real-time call duration tracking
✅ Disposition tracking and reporting

---

## 🏗️ Architecture

### Components

1. **CallContext** (`src/context/CallContext.js`)
   - Global state management for active calls
   - Manages call start/end and form visibility
   - Tracks call duration in real-time

2. **CallTimerBar** (`src/components/CallTimerBar.js`)
   - Sticky bar at the top of every page
   - Shows lead name, phone, and live timer
   - "End Call" and "Not Connected" buttons
   - Animated pulsing green dot

3. **CallButton** (`src/components/CallButton.js`)
   - Reusable button component for initiating calls
   - Can be placed next to any phone number
   - Multiple size variants (xs, sm, md, lg)

4. **CallForm** (`src/components/CallForm.js`)
   - Detailed form popup when "End Call" is clicked
   - Dynamic fields based on loan type selected
   - Multiple disposition options
   - Agent notes section

5. **CallHistory** (`src/components/CallHistory.js`)
   - Display previous calls for a lead
   - Expandable call details
   - Shows loan info and notes from previous calls

6. **CallAnalyticsDashboard** (`src/components/CallAnalyticsDashboard.js`)
   - Real-time agent performance metrics
   - Total calls, talk time, conversion rates
   - Disposition summary
   - Date range filtering

---

## 📁 File Structure

```
src/
├── context/
│   └── CallContext.js           # Global call state
├── components/
│   ├── CallTimerBar.js          # Floating timer
│   ├── CallTimerBar.css
│   ├── CallButton.js            # Call initiation button
│   ├── CallButton.css
│   ├── CallForm.js              # Call details form
│   ├── CallForm.css
│   ├── CallHistory.js           # Call history display
│   ├── CallHistory.css
│   ├── CallAnalyticsDashboard.js # Manager dashboard
│   └── CallAnalyticsDashboard.css
├── services/
│   └── callService.js           # API functions
├── pages/
│   ├── Calls.js / Calls.css     # Call management page
│   └── Leads.js                 # Updated with call buttons
├── App.js                        # Updated with CallProvider
└── DATABASE_SCHEMA.sql          # SQL for call_logs table
```

---

## 🗄️ Database Setup

### Required Table: `call_logs`

You must create this table in your Supabase database:

```sql
CREATE TABLE call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id),
  agent_id UUID NOT NULL REFERENCES profiles(id),
  phone_number VARCHAR(20) NOT NULL,
  duration_seconds INTEGER DEFAULT 0,
  disposition VARCHAR(50),
  loan_details JSONB,
  notes TEXT,
  connected BOOLEAN DEFAULT true,
  call_timestamp TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);
```

**How to create:**
1. Go to your Supabase Dashboard
2. Click "SQL Editor"
3. Create a new query
4. Copy the SQL from `DATABASE_SCHEMA.sql`
5. Execute the query

---

## 🚀 Getting Started

### 1. Installation

No additional packages needed! The system uses existing dependencies:
- React (hooks)
- Supabase (@supabase/supabase-js)
- Tabler Icons (@tabler/icons-react)
- React Hot Toast (for notifications)

### 2. Integration Steps

**Step 1:** Create the `call_logs` table (see Database Setup above)

**Step 2:** App.js is already updated with:
```jsx
<CallProvider>
  <CallTimerBar />
  <CallForm userId={userId} />
  {/* Rest of your app */}
</CallProvider>
```

**Step 3:** Components are ready to use in any page:
```jsx
import CallButton from '../components/CallButton'
import CallHistory from '../components/CallHistory'

// Add call button next to phone
<CallButton 
  phoneNumber={lead.mobile} 
  leadName={lead.full_name} 
  leadId={lead.id} 
  size="sm" 
/>

// Show call history for a lead
<CallHistory leadId={lead.id} />
```

---

## 🎯 How It Works

### Call Flow

1. **Initiate Call**
   - User clicks Call button next to a phone number
   - CallContext activates
   - CallTimerBar appears at top with lead details
   - Timer starts counting

2. **Active Call**
   - CallTimerBar visible on all pages
   - User can navigate while timer runs
   - User can click "Not Connected" to close without form
   - User clicks "End Call" to open the details form

3. **Call Form**
   - Select loan type
   - Fill basic details (Salary, Company, Employment Type)
   - Fill loan-specific fields based on type selected
   - Select disposition (Interested, Callback, etc.)
   - Add notes
   - Click "Save Call"

4. **Save to Database**
   - Call log saved with all details
   - Duration in exact seconds
   - Loan details as JSON
   - Disposition and notes
   - Timestamp for analytics

5. **View History**
   - Open CallHistory component for any lead
   - Click to expand call details
   - See all previous loan information
   - View agent notes

---

## 🎨 UI Features

### CallTimerBar Styling
- **Fixed at top** when call is active
- **Dark gradient background** with red accent
- **Live timer** in monospace font
- **Green pulsing dot** indicating active call
- **Responsive** - adapts to mobile

### CallButton Variants
- **xs**: Icon only, minimal size
- **sm**: With "Call" text
- **md**: Slightly larger
- **lg**: Full-sized button

### CallForm Features
- **Dynamic fields** based on loan type
- **Disposition quick-select** buttons
- **Expandable sections** for organization
- **Responsive** form grid
- **Mobile-friendly** modal

### Analytics Dashboard
- **4 main stat cards** (Total Calls, Talk Time, Connected Rate, Active Agents)
- **Agent performance table** with sortable data
- **Disposition summary** with visual bars
- **Date filtering** (Today, This Week, This Month)

---

## 📊 Dispositions Supported

- ✅ **Interested** (Green) - Lead interested in product
- 🔄 **Callback** (Orange) - Callback scheduled
- ❌ **Not Interested** (Red) - Lead not interested
- 🔴 **RNR** (Purple) - Not reachable
- 📵 **Busy** (Indigo) - Lead was busy
- 📴 **Switched Off** (Gray) - Phone switched off
- 🚫 **DND** (Dark Red) - Do Not Disturb

---

## 💾 Data Stored in call_logs

```json
{
  "id": "UUID",
  "lead_id": "UUID",
  "agent_id": "UUID",
  "phone_number": "+919876543210",
  "duration_seconds": 285,
  "disposition": "Interested",
  "connected": true,
  "loan_details": {
    "loanType": "Personal Loan",
    "salary": "50000",
    "company": "ABC Corp",
    "employmentType": "Salaried",
    "personalLoan": {
      "bankName": "HDFC",
      "loanAmount": "500000",
      "emiAmount": "12500",
      "outstandingAmount": "250000",
      "emisPaid": "20",
      "tenure": "48",
      "anyBounce": "No"
    }
  },
  "notes": "Customer interested in increasing loan amount",
  "call_timestamp": "2024-05-16T10:30:00Z",
  "created_at": "2024-05-16T10:30:00Z"
}
```

---

## 🔐 Security & RLS

The call_logs table includes Row-Level Security (RLS) policies:

- **Agents** can only view and insert their own call logs
- **Managers** can view all call logs
- **Admins** have full control

RLS is automatically enforced by Supabase.

---

## 📱 Mobile Optimization

All components are fully responsive:
- Call timer bar adapts to mobile layout
- Call form works on small screens
- Buttons sized appropriately
- Touch-friendly spacing
- Scrollable content on small devices

---

## 🔧 Customization

### Change Colors
Edit the CSS files:
- `CallTimerBar.css` - Timer bar styling
- `CallButton.css` - Button colors
- `CallForm.css` - Form appearance

### Add More Loan Types
In `CallForm.js`:
```jsx
const LOAN_TYPES = [
  'Personal Loan',
  'Housing Loan',
  // Add your types here
  'My Custom Loan Type'
]
```

Then add matching form fields below.

### Add More Dispositions
In `CallForm.js` and `CallAnalyticsDashboard.js`:
```jsx
const DISPOSITION_OPTIONS = [
  { label: 'My Disposition', color: '#color' },
  // Add more
]
```

---

## 🐛 Troubleshooting

### Call button not appearing?
- Check that CallButton is imported
- Verify phone number is not null
- Check browser console for errors

### Timer bar not showing?
- Ensure CallProvider wraps the entire app in App.js
- Check that CallContext is properly imported
- Verify CallTimerBar component is rendered in App.js

### Calls not saving?
- Check that call_logs table exists in Supabase
- Verify table has correct column names
- Check RLS policies allow insert/select
- Look at browser console for SQL errors

### Analytics not loading?
- Ensure call_logs table has data
- Check that user role is 'manager' or 'admin'
- Verify date range in filter

---

## 📈 Usage Analytics

The system automatically tracks:
- Total calls per agent
- Total talk time per agent
- Connected vs not connected ratio
- Disposition breakdown
- Call trends over time periods

Access via:
- Managers/Admins: Dedicated Call Management page
- Agents: Recent calls list on Dashboard

---

## 🎓 Example: Adding Calls to a Page

```jsx
import CallButton from '../components/CallButton'
import CallHistory from '../components/CallHistory'

export default function MyPage() {
  return (
    <div>
      <h1>Lead: John Doe</h1>
      <p>Phone: 9876543210</p>
      
      {/* Add call button */}
      <CallButton 
        phoneNumber="9876543210"
        leadName="John Doe"
        leadId="lead-uuid"
        size="md"
      />
      
      {/* Show previous calls */}
      <CallHistory leadId="lead-uuid" />
    </div>
  )
}
```

---

## 🚀 Next Steps

1. ✅ Create the `call_logs` table in Supabase
2. ✅ Test initiating a call
3. ✅ Fill out the call form
4. ✅ Verify data saves to database
5. ✅ Check analytics dashboard
6. ✅ Customize colors and fields as needed

---

## 📞 Support

For issues or questions:
1. Check the troubleshooting section
2. Verify database schema is correct
3. Check browser console for errors
4. Review the component code and comments
5. Test in a new lead record first

---

**Call System Build Complete!** 🎉

Your CRM now has a fully functional call management system with tracking, analytics, and detailed reporting.
