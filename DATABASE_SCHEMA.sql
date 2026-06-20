/*
SUPABASE DATABASE SCHEMA FOR CALL SYSTEM

This document outlines the database schema required for the complete Call System.
Please create these tables in your Supabase database.

1. CALL_LOGS TABLE
   - Stores all call records
*/

-- Create call_logs table
CREATE TABLE call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  phone_number VARCHAR(20) NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  disposition VARCHAR(50), -- Interested, Callback, Not Interested, RNR, Busy, Switched Off, DND
  loan_details JSONB, -- Stores all loan details as JSON
  notes TEXT,
  connected BOOLEAN DEFAULT true,
  call_timestamp TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX idx_call_logs_lead_id ON call_logs(lead_id);
CREATE INDEX idx_call_logs_agent_id ON call_logs(agent_id);
CREATE INDEX idx_call_logs_call_timestamp ON call_logs(call_timestamp);
CREATE INDEX idx_call_logs_disposition ON call_logs(disposition);

-- Enable RLS (Row Level Security)
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for call_logs
-- Agents can insert their own call logs
CREATE POLICY "Agents can insert own calls"
  ON call_logs FOR INSERT
  WITH CHECK (auth.uid() = agent_id);

-- Agents can view own call logs
CREATE POLICY "Agents can view own calls"
  ON call_logs FOR SELECT
  USING (auth.uid() = agent_id);

-- Managers and admins can view all call logs
CREATE POLICY "Managers can view all calls"
  ON call_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('manager', 'admin')
    )
  );

-- Admins can update and delete
CREATE POLICY "Admins can manage all calls"
  ON call_logs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'admin'
    )
  );

/*
LOAN_DETAILS JSON STRUCTURE:

{
  "loanType": "Personal Loan | Housing Loan | Credit Card | Education Loan | Car Loan | Bike Loan | Consumer Durable Loan",
  "salary": "Monthly Salary",
  "company": "Company Name",
  "employmentType": "Salaried | Self Employed | Business | Freelance",
  
  // For Personal Loan
  "personalLoan": {
    "bankName": "string",
    "loanAmount": "number",
    "emiAmount": "number",
    "outstandingAmount": "number",
    "emisPaid": "number",
    "tenure": "number",
    "anyBounce": "Yes | No"
  },
  
  // For Housing Loan
  "housingLoan": {
    "loanAmount": "number",
    "emiAmount": "number",
    "jointStatus": "Individual | Joint",
    "relationWithJoint": "string (if Joint)",
    "jointHolderIncome": "number (if Joint)",
    "emiPaidBy": "Self | Co-applicant | Both (if Joint)"
  },
  
  // For Credit Card
  "creditCard": {
    "bankName": "string",
    "creditLimit": "number",
    "outstandingAmount": "number",
    "anyOverdue": "Yes | No"
  },
  
  // For Education Loan
  "educationLoan": {
    "loanAmount": "number",
    "emiAmount": "number",
    "paidBy": "Self | Other"
  },
  
  // For Car Loan, Bike Loan, Consumer Durable Loan
  "carLoan | bikeLoan | consumerDurableLoan": {
    "loanAmount": "number",
    "emiAmount": "number",
    "emisLeft": "number"
  }
}

MIGRATION STEPS:
1. Copy the CREATE TABLE statement above
2. Paste it in Supabase SQL Editor
3. Execute the query
4. The table and indexes will be created
5. RLS policies will be automatically applied
6. Your call system is ready to use!

IMPORTANT NOTES:
- Make sure the 'leads' and 'profiles' tables exist
- Ensure 'leads' table has an 'id' column (UUID PRIMARY KEY)
- Ensure 'profiles' table has 'id' and 'role' columns
- Test RLS policies by using the app in different roles
*/
