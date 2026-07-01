/**
 * Phase 11 — General & Conduct document library (block-model). LIVE wording.
 *
 * Eight academy documents built on the MemoDocument engine (paragraph + LOCKED
 * clause blocks). Unlike the academic-action letters in reportTypes.tsx, these
 * are jurisdiction-NEUTRAL and apply to any discipline (category 'general').
 *
 * LEGAL POSTURE (finalized 2026-07-01, replacing the draft placeholders):
 *  - No statutory or manual SECTION NUMBERS are asserted — no org's internal
 *    numbering can be known here, so references are generic-but-precise
 *    ("the Academy Cadet Manual and applicable academy policy"). Where a
 *    concrete term is legally required at issue time (the conduct-dismissal
 *    appeal authority + deadline), it is a REQUIRED form field the issuing
 *    authority fills, never boilerplate.
 *  - Adverse documents state facts, preserve response/appeal rights, and make
 *    acknowledgment signatures receipt-only (never agreement).
 *  - MemoRenderer still hard-flags any [bracketed placeholder] that reaches a
 *    rendered document (owner-authored custom forms), so nothing unresolved
 *    can be issued unnoticed.
 */
import type { ReportType } from './reportTypes';

export const DOCUMENT_TYPES: ReportType[] = [
  {
    id: 'crossover_transfer',
    name: 'Crossover / Blackbird Transfer Memo',
    purpose: 'Certifies that a cadet completed a specific course of training (hours + passing written-exam score) in one class, so the credit can transfer (crossover / blackbird) to the cadet\'s file or another program.',
    reSubject: 'Crossover / Blackbird Transfer — {cadetName}',
    fields: [
      { key: 'fromSequence', label: 'From (Sequence No.)', type: 'text', required: true, hint: "The issuing academy's Sequence No. (the From line)" },
      { key: 'course', label: 'Course (CJK)', type: 'course', required: true, hint: 'CJK number + course name as it appears with CJSTC' },
      { key: 'className', label: 'Class completed in', type: 'text', required: true, defaultFrom: 'className', hint: 'e.g. LE 131' },
      { key: 'classSequence', label: 'Class Sequence No.', type: 'text', required: true, hint: 'Sequence No. of the class where the training was completed' },
      { key: 'hours', label: 'Hours of training completed', type: 'number', required: true },
      { key: 'score', label: 'Written exam score (%)', type: 'number', required: true },
    ],
    document: {
      appliesTo: 'cadet',
      headerFields: [
        { label: 'To:', value: '{directorName}, Director' },
        { label: 'CC:', value: 'Personnel File' },
        { label: 'From:', value: '{fromSequence}' },
        { label: 'Date:', value: '{memoDate}' },
        { label: 'Re:', value: '{cadetName}' },
        { label: 'Course:', value: '{course}' },
      ],
      blocks: [
        { kind: 'paragraph', text: `{cadetName} has completed the listed training with {className} (Sequence No. {classSequence}). The cadet completed {hours} hours of training and passed the written examination with a score of {score}%.` },
        { kind: 'clause', text: `This memorandum certifies the training completion described above based on the academy's official training and grade records as of {memoDate}, and is recorded as a permanent part of the cadet's training file for crossover / transfer-of-training purposes. The statements set forth above are true and accurate to the best of the issuing authority's knowledge.` },
      ],
      signerLine: '{fromName}, Training Coordinator',
      distribution: ['{directorName}, Academy Director', 'Personnel File', 'Training File'],
    },
  },
  {
    id: 'general_memo',
    name: 'General Memorandum',
    purpose: 'All-purpose internal academy memorandum for any recipient on any subject, recorded on letterhead for the training file.',
    reSubject: '{subject}',
    fields: [
      { key: 'recipient', label: 'To (Recipient)', type: 'text', required: true, hint: 'Name and/or title of the person or group addressed' },
      { key: 'ccRecipient', label: 'CC (Copy To)', type: 'text', hint: 'Optional — leave blank to omit the CC row (the Academy Director is on the distribution list regardless)' },
      { key: 'subject', label: 'Subject (Re)', type: 'text', required: true, hint: 'Short subject line; drives the Re row' },
      { key: 'body', label: 'Memorandum Body', type: 'textarea', required: true, hint: 'The narrative of the memorandum, in complete, professional prose' },
      { key: 'signerTitle', label: 'Issuing Authority Title', type: 'select', required: true, hint: 'Title under the signature line; reflects who is actually issuing this memo', options: ['Training Coordinator', 'Lead Instructor', 'Academy Director', 'Lieutenant'] },
    ],
    document: {
      appliesTo: 'general',
      headerFields: [
        { label: 'To:', value: '{recipient}' },
        { label: 'From:', value: '{fromName}' },
        { label: 'CC:', value: '{ccRecipient}' },
        { label: 'Date:', value: '{memoDate}' },
        { label: 'Re:', value: '{subject}' },
      ],
      blocks: [
        { kind: 'paragraph', text: `{body}` },
        { kind: 'clause', text: `This memorandum is issued under the authority of the academy training staff and is recorded contemporaneously as part of the training program's official records. The statements set forth above are true and accurate to the best of the issuing authority's knowledge as of {memoDate}. This memorandum is maintained as a permanent record and may be relied upon for administrative and training-review purposes.` },
      ],
      signerLine: '{fromName}, {signerTitle}',
      distribution: ['Recipient', '{directorName}, Academy Director', 'Training File'],
    },
  },
  {
    id: 'counseling',
    name: 'Counseling / Remediation',
    purpose: 'Documents a counseling session and a structured remediation plan with a cadet as a developmental step before formal discipline.',
    reSubject: 'Counseling and Remediation Plan — {area}',
    fields: [
      { key: 'dateOfCounseling', label: 'Date of Counseling Session', type: 'date', required: true, hint: 'Date the counseling session was held' },
      { key: 'area', label: 'Area of Concern', type: 'text', required: true, hint: 'Skill, performance, or conduct area addressed (e.g., defensive tactics proficiency, punctuality)' },
      { key: 'concern', label: 'Concern / What Was Observed and Discussed', type: 'textarea', required: true, hint: 'Factual summary of the observed deficiency and what was discussed during the session' },
      { key: 'remediationPlan', label: 'Remediation Plan', type: 'textarea', required: true, hint: 'Specific expectations, the support and resources offered, and the timeline for improvement' },
      { key: 'cadetResponse', label: "Cadet's Response / Statement (if any)", type: 'textarea', hint: 'Summary of any response, explanation, or input the cadet provided during the session; leave blank if none' },
      { key: 'followUpDate', label: 'Follow-Up / Review Date', type: 'date', required: true, hint: "Date the cadet's progress will be reviewed" },
      { key: 'consequences', label: 'Potential Consequences if Expectations Are Not Met', type: 'textarea', required: true, hint: 'What may follow if the remediation expectations are not met' },
    ],
    document: {
      appliesTo: 'cadet',
      headerFields: [
        { label: 'To:', value: '{cadetName}, Cadet' },
        { label: 'From:', value: '{fromName}, Training Coordinator' },
        { label: 'CC:', value: '{directorName}, Academy Director' },
        { label: 'Date:', value: '{memoDate}' },
        { label: 'Re:', value: '{reSubject}' },
      ],
      blocks: [
        { kind: 'paragraph', text: `On {dateOfCounseling}, a counseling session was held with Cadet {cadetName} to address performance in the area of {area}. This memorandum documents the matters discussed and the remediation plan established during that session. It is prepared contemporaneously as a developmental record.` },
        { kind: 'paragraph', text: `The following concern was observed and discussed during the session: {concern}` },
        { kind: 'paragraph', text: `To support improvement in this area, the following remediation plan was established, including expectations, available support, and the applicable timeline: {remediationPlan}` },
        { kind: 'paragraph', text: `Cadet {cadetName} was given the opportunity to respond and to provide input during the session. The cadet's response, if any, was as follows: {cadetResponse}` },
        { kind: 'paragraph', text: `Cadet {cadetName}'s progress under this plan will be reviewed on or about {followUpDate}. If the expectations set out above are not met, the following may result: {consequences}` },
        { kind: 'clause', text: `This counseling and remediation record is a developmental measure intended to support the cadet's success in the academy and is not, by itself, a formal disciplinary action. It documents that the concern was communicated, that a plan for improvement and supporting resources were provided, that the cadet was given the opportunity to respond, and that the cadet was advised of the standards expected. A copy of this record was provided to the cadet. Continued or repeated deficiency in this area may result in further counseling or formal disciplinary action in accordance with the Academy Cadet Manual and applicable academy remediation and discipline policy. The statements of fact recorded in this memorandum were documented at or near the time of the counseling session and are believed to be true and accurate. Nothing in this record limits any review, response, or appeal rights afforded to the cadet under applicable academy policy. The cadet's signature below indicates receipt and understanding only and does not indicate agreement; if the cadet declines to sign, that fact may be noted by the witnessing instructor and does not invalidate this record.` },
      ],
      signerLine: '{fromName}, Training Coordinator',
      acknowledgment: 'I acknowledge that this counseling session was held with me, that the concern and the remediation plan described above were reviewed with me, and that I was given the opportunity to ask questions and respond. My signature indicates receipt and understanding of this document; it does not necessarily indicate agreement with its contents.',
      ackSignerLabel: 'Cadet',
      distribution: ['Cadet', 'Student File', 'Training File', '{directorName}, Academy Director'],
    },
  },
  {
    id: 'injury_illness',
    name: 'Injury / Illness Report',
    purpose: 'Documents a cadet training injury or illness for the safety and medical record, including treatment, referral, notifications, and return-to-training status.',
    reSubject: 'Injury / Illness Report — {cadetSubject}',
    fields: [
      { key: 'cadetSubject', label: 'Affected Cadet', type: 'cadet', required: true, hint: 'Select the cadet who sustained the injury or illness.' },
      { key: 'dateOfInjury', label: 'Date of Injury / Onset of Illness', type: 'date', required: true },
      { key: 'timeOfInjury', label: 'Time of Injury / Onset', type: 'time', required: true, hint: 'Approximate time if exact time is unknown.' },
      { key: 'location', label: 'Location', type: 'text', required: true, hint: 'Where it occurred (e.g., mat room, range, track, classroom).' },
      { key: 'activity', label: 'Activity / Course or Scenario', type: 'text', required: true, hint: 'Training course or scenario underway when it occurred.' },
      { key: 'description', label: 'Description of How It Occurred', type: 'textarea', required: true, hint: 'Factual, chronological account of events; avoid conclusions or fault.' },
      { key: 'natureOfInjury', label: 'Nature of Injury / Illness', type: 'text', required: true, hint: 'Body part affected and nature (e.g., right ankle sprain, heat exhaustion).' },
      { key: 'safetyEquipment', label: 'Required Protective Equipment in Use', type: 'select', hint: 'Whether required protective/safety equipment was in use at the time.', options: ['Yes', 'No', 'Not applicable', 'Unknown'] },
      { key: 'treatmentProvided', label: 'Treatment / First Aid Provided', type: 'textarea', required: true, hint: 'First aid administered on scene and by whom.' },
      { key: 'medicalReferral', label: 'Medical Referral', type: 'select', required: true, hint: 'Level of medical care directed.', options: ['None', 'On-site medical', 'Sent to physician/urgent care', 'Emergency room/EMS'] },
      { key: 'witnesses', label: 'Witnesses', type: 'text', hint: 'Names of cadets or staff who observed the event; enter "None" if none.' },
      { key: 'notifications', label: 'Notifications Made', type: 'textarea', hint: "Who was notified and when (e.g., Academy Director, EMS, agency reporting/workers'-comp coordinator); enter \"None\" if none." },
      { key: 'returnToTraining', label: 'Return-to-Training Status', type: 'select', required: true, hint: "Cadet's training status following the incident.", options: ['Returned to training', 'Restricted/modified participation', 'Held pending medical clearance'] },
    ],
    document: {
      appliesTo: 'file',
      headerFields: [
        { label: 'To:', value: 'File' },
        { label: 'From:', value: '{fromName}, Reporting Instructor' },
        { label: 'CC:', value: '{directorName}, Academy Director' },
        { label: 'Date:', value: '{memoDate}' },
        { label: 'Re:', value: '{reSubject}' },
      ],
      blocks: [
        { kind: 'paragraph', text: `This report documents a training-related injury or illness involving cadet {cadetSubject} for the academy safety and medical record. On {dateOfInjury} at approximately {timeOfInjury}, the cadet reported or was observed to have sustained an injury or experienced an illness at {location} during {activity}.` },
        { kind: 'paragraph', text: `Description of how it occurred: {description}` },
        { kind: 'paragraph', text: `The reported nature of the injury or illness was {natureOfInjury}. Required protective or safety equipment in use at the time: {safetyEquipment}. The following treatment or first aid was provided: {treatmentProvided}. Medical referral: {medicalReferral}. Witnesses present: {witnesses}. Notifications made: {notifications}.` },
        { kind: 'paragraph', text: `Following the incident, the cadet's training status was recorded as: {returnToTraining}.` },
        { kind: 'clause', text: `This report records observations and factual information only and does not constitute a medical diagnosis or clinical determination. Medical information contained in this report is confidential and shall be maintained and disclosed only as permitted by applicable law and academy policy. Any reporting, notification, or insurance obligations arising from a training-related injury or illness shall be carried out as required by applicable law and academy policy. The cadet's return to full, unrestricted training participation is contingent upon medical clearance and a determination of fitness to safely resume training activities in accordance with academy policy.` },
        { kind: 'clause', text: `The facts stated above were recorded contemporaneously with, or as soon as practicable after, the events described, based on the personal knowledge of the reporting instructor and the accounts of the cadet and any witnesses. The reporting instructor attests that this account is true and complete to the best of his or her knowledge. Any cadet or witness statements referenced herein were recorded at or near the time of the incident.` },
      ],
      signerLine: '{fromName}, Reporting Instructor',
      acknowledgment: 'I have reviewed this report and acknowledge that the account of the injury or illness set forth above is accurate to the best of my knowledge. My acknowledgment does not waive any right and does not constitute a medical determination.',
      ackSignerLabel: 'Cadet',
      distribution: ['Student File', 'Safety/Medical File', '{directorName}, Academy Director'],
    },
  },
  {
    id: 'incident',
    name: 'Incident Report',
    purpose: 'Records a non-injury, non-use-of-force training incident (property damage, safety/security event, or conduct/scenario irregularity) as a factual, contemporaneous account for the file.',
    reSubject: 'Incident Report — {dateOfIncident}, {location}',
    fields: [
      { key: 'dateOfIncident', label: 'Date of Incident', type: 'date', required: true, hint: 'Calendar date the incident occurred or was observed.' },
      { key: 'timeOfIncident', label: 'Time of Incident', type: 'time', required: true, hint: 'Approximate time the incident occurred or was observed.' },
      { key: 'location', label: 'Location', type: 'text', required: true, hint: 'Specific location (building, room, range, or scenario site).' },
      { key: 'incidentType', label: 'Type of Incident', type: 'select', hint: 'Select the category that best fits; use Other if none apply.', options: ['Property damage', 'Safety or security event', 'Conduct or scenario irregularity', 'Other'] },
      { key: 'personsInvolved', label: 'Person(s) Involved', type: 'text', required: true, hint: 'Names and roles of cadets, staff, or others directly involved.' },
      { key: 'description', label: 'Description of Incident', type: 'textarea', required: true, hint: 'Factual, chronological account of what occurred. Observations only.' },
      { key: 'actionTaken', label: 'Immediate Action Taken', type: 'textarea', required: true, hint: 'Response taken at the time and steps to secure the scene or property.' },
      { key: 'notifiedParties', label: 'Notifications Made', type: 'text', hint: 'Who was notified and when (e.g., supervisor, director, facilities); leave blank if none.' },
      { key: 'witnesses', label: 'Witness(es)', type: 'text', required: true, hint: 'Names of any witnesses. Enter "None" if there were no witnesses.' },
    ],
    document: {
      appliesTo: 'file',
      headerFields: [
        { label: 'To:', value: 'File' },
        { label: 'From:', value: '{fromName}' },
        { label: 'CC:', value: '{directorName}, Academy Director' },
        { label: 'Date:', value: '{memoDate}' },
        { label: 'Re:', value: '{reSubject}' },
      ],
      blocks: [
        { kind: 'paragraph', text: `This report documents an incident occurring during academy training operations. On {dateOfIncident} at approximately {timeOfIncident}, an incident of the following type occurred at {location}: {incidentType}. The following person(s) were directly involved: {personsInvolved}.` },
        { kind: 'paragraph', text: `Description of incident: {description}` },
        { kind: 'paragraph', text: `Immediate action taken: {actionTaken}` },
        { kind: 'paragraph', text: `Notifications made at the time of the incident: {notifiedParties}.` },
        { kind: 'paragraph', text: `Witness(es) to the incident: {witnesses}.` },
        { kind: 'paragraph', text: `This report is submitted for inclusion in the academy incident file and for administrative review. It is intended solely to memorialize the event described above and does not itself constitute a finding of fault, a disciplinary determination, or an adverse action against any person named herein. Any incident concerning a personal injury or illness, or any application or observation of force in a training scenario, is documented separately on its designated form in accordance with academy policy.` },
        { kind: 'clause', text: `ATTESTATION OF ACCURACY. I certify that the foregoing is a true, accurate, and complete account of the incident to the best of my knowledge, information, and belief. The facts set forth above are recorded contemporaneously with, or as soon as practicable after, the events described and are based on my own direct observation except where this report expressly attributes information to another person. Where this report reflects my opinion, inference, or conclusion rather than a fact I personally observed, I have identified it as such. I have not knowingly omitted, exaggerated, or misstated any material fact. I understand that this report becomes part of a permanent training record, that it may be relied upon in subsequent administrative, disciplinary, or legal proceedings, and that the knowing submission of false information may itself be grounds for disciplinary action under the academy's code of conduct and truthfulness standards.` },
      ],
      signerLine: '{fromName}, Reporting Person',
      distribution: ['Incident File', '{directorName}, Academy Director'],
    },
  },
  {
    id: 'use_of_force',
    name: 'Use of Force (Training Scenario)',
    purpose: 'Documents force applied or observed during a controlled training scenario for after-action review and risk management.',
    reSubject: 'Use of Force During Training Scenario — {cadetSubject}',
    fields: [
      { key: 'cadetSubject', label: 'Cadet (applied or received force in scenario)', type: 'cadet', required: true, hint: 'Select the cadet who applied or received the documented force' },
      { key: 'dateOfIncident', label: 'Date of Scenario', type: 'date', required: true },
      { key: 'timeOfIncident', label: 'Time of Scenario', type: 'time', required: true, hint: 'Approximate time the force occurred' },
      { key: 'scenario', label: 'Course / Scenario', type: 'text', required: true, hint: 'Course block, scenario name, or lesson (e.g., defensive tactics, reality-based scenario)' },
      { key: 'forceType', label: 'Type of Force Documented', type: 'select', required: true, hint: 'Select the primary force type observed in the training scenario', options: ['Verbal commands', 'Empty-hand control/escort', 'Joint manipulation/takedown', 'Striking technique (training)', 'OC/chemical (training agent)', 'Impact weapon (training)', 'Conducted-energy device (simulation)', 'Firearm (simulation/marking cartridge)', 'Other'] },
      { key: 'forceTypeOther', label: 'If "Other," specify force type', type: 'text', hint: 'Complete only if "Other" was selected above; otherwise leave blank' },
      { key: 'reasonForForce', label: 'Scenario Context and Trained Justification', type: 'textarea', required: true, hint: 'Scenario objective and the trained justification the cadet was practicing' },
      { key: 'description', label: 'Factual Sequence', type: 'textarea', required: true, hint: 'Objective, chronological account of what occurred' },
      { key: 'injuries', label: 'Injuries', type: 'textarea', required: true, hint: 'Describe any injury to any participant, or enter "None reported"' },
      { key: 'medicalProvided', label: 'Medical Attention Provided', type: 'text', required: true, hint: 'What care was given and by whom, or "None required"' },
      { key: 'safetyOfficer', label: 'Assigned Safety Officer', type: 'text', required: true, hint: 'Name of the safety officer present and supervising the scenario' },
      { key: 'witnesses', label: 'Witnesses', type: 'text', required: true, hint: 'Names of instructors, role-players, or cadets who observed, or enter "None"' },
    ],
    document: {
      appliesTo: 'file',
      headerFields: [
        { label: 'To:', value: 'Training File' },
        { label: 'From:', value: '{fromName}, Training Instructor' },
        { label: 'CC:', value: '{directorName}, Academy Director' },
        { label: 'Date:', value: '{memoDate}' },
        { label: 'Re:', value: '{reSubject}' },
      ],
      blocks: [
        { kind: 'paragraph', text: `This memorandum documents force applied or observed during a controlled training scenario involving Cadet {cadetSubject}. It is recorded contemporaneously for after-action review and risk-management purposes and does not concern any field or operational use of force.` },
        { kind: 'paragraph', text: `The scenario took place on {dateOfIncident} at approximately {timeOfIncident} during {scenario}. The assigned safety officer present and supervising the scenario was {safetyOfficer}. Witnesses to the scenario included {witnesses}.` },
        { kind: 'paragraph', text: `Type of force documented: {forceType} {forceTypeOther}. Scenario context and the trained justification the cadet was practicing: {reasonForForce}.` },
        { kind: 'paragraph', text: `Factual sequence of events: {description}` },
        { kind: 'paragraph', text: `Injuries: {injuries}. Medical attention provided: {medicalProvided}. Any injury was handled in accordance with the academy injury-reporting procedure.` },
        { kind: 'clause', text: `The force described in this record occurred within a controlled training environment, under direct instructor supervision and in the presence of an assigned safety officer. The techniques applied or observed were conducted as part of structured instruction consistent with the academy's defensive-tactics and use-of-force training standards and the approved lesson plan. This document records training force solely for after-action review and risk-management purposes; it is an instructional and risk-management record, is not a disciplinary or adverse action, and does not by itself constitute a finding of misconduct or an admission by any participant. It does not constitute or describe a field or operational use of force. The information above is recorded contemporaneously and to the best of the preparer's knowledge is true, accurate, and complete. Any injury arising from the scenario was addressed under the academy's injury-reporting and medical-response procedures; any participant who sustained injury shall be evaluated and cleared for return to training in accordance with the academy's medical-clearance and return-to-training requirements. All related medical information shall be handled as confidential in accordance with applicable privacy requirements.` },
      ],
      signerLine: '{fromName}, Training Instructor',
      distribution: ['Training File', '{directorName}, Academy Director', 'Assigned Safety Officer', 'Sponsoring Agency (if applicable)'],
    },
  },
  {
    id: 'disciplinary',
    name: 'Disciplinary Action',
    purpose: 'Documents a cadet conduct or policy violation and the disciplinary action imposed, with due-process notice and cadet acknowledgment of receipt.',
    reSubject: 'Disciplinary Action — {cadetName}',
    fields: [
      { key: 'dateOfViolation', label: 'Date of Violation', type: 'date', required: true, hint: 'Date the conduct or policy violation occurred' },
      { key: 'policyViolated', label: 'Policy / Standard Violated', type: 'text', required: true, hint: 'Rule or standard implicated; reference the cadet manual section if applicable' },
      { key: 'description', label: 'Description of Violation', type: 'textarea', required: true, hint: 'Factual account of what occurred, recorded contemporaneously' },
      { key: 'priorActions', label: 'Prior Counseling / Warnings', type: 'textarea', required: true, hint: 'Prior counseling or warnings on this matter, or enter "None"' },
      { key: 'actionTaken', label: 'Action Taken', type: 'select', required: true, hint: 'Disciplinary action imposed', options: ['Verbal warning (documented)', 'Written warning', 'Probation', 'Suspension from training', 'Referral for dismissal'] },
      { key: 'conditions', label: 'Corrective Conditions / Terms', type: 'textarea', required: true, hint: 'Corrective conditions, probation terms, or duration; enter "None" if not applicable' },
    ],
    document: {
      appliesTo: 'cadet',
      headerFields: [
        { label: 'To:', value: '{cadetName}, Cadet' },
        { label: 'From:', value: '{fromName}, Training Coordinator' },
        { label: 'CC:', value: '{directorName}, Academy Director' },
        { label: 'Date:', value: '{memoDate}' },
        { label: 'Re:', value: '{reSubject}' },
      ],
      blocks: [
        { kind: 'paragraph', text: `This memorandum documents a conduct or policy violation by Cadet {cadetName} and the disciplinary action taken in response. On {dateOfViolation}, the following occurred: {description}` },
        { kind: 'paragraph', text: `This conduct implicates the following academy policy or standard: {policyViolated}. The applicable conduct expectations for cadets are set forth in the Academy Cadet Manual and applicable academy policy.` },
        { kind: 'paragraph', text: `Prior counseling or warnings relevant to this matter: {priorActions}` },
        { kind: 'paragraph', text: `Based on the foregoing, the following disciplinary action is imposed: {actionTaken}. The corrective conditions, terms, and applicable duration are as follows: {conditions}. Cadet {cadetName} is expected to comply fully with these conditions for the period specified.` },
        { kind: 'clause', text: `The facts recorded in this memorandum are based on direct observation and information available to the issuing coordinator at the time of writing, are recorded contemporaneously with the events described, and are believed to be true and accurate. This memorandum documents the disciplinary determination as of {memoDate} and is maintained as part of the cadet's permanent training record.` },
        { kind: 'clause', text: `Cadet {cadetName} has the right to respond to this action and to appeal it in accordance with the academy's disciplinary procedure, a copy of which is available from the Academy office. Any written response or appeal must be submitted within the time period stated in that procedure and, once received, will be retained with this memorandum as part of the cadet's training record. This memorandum reflects the disciplinary determination as of {memoDate} and may be supplemented or modified following any timely response or appeal. The cadet is further advised that any further violation of academy policy or of the conditions stated above may result in escalated disciplinary action, up to and including dismissal from the training program.` },
      ],
      signerLine: '{fromName}, Training Coordinator',
      acknowledgment: 'I acknowledge that I have received and reviewed this disciplinary action memorandum and that its contents have been explained to me. My signature confirms receipt only and does not indicate agreement with the findings or the action taken. I understand my right to respond and to appeal as described above.',
      ackSignerLabel: 'Cadet',
      distribution: ['Cadet', 'Student/Conduct File', '{directorName}, Academy Director'],
    },
  },
  {
    id: 'dismissal_conduct',
    name: 'Dismissal — Conduct / Administrative',
    purpose: "Documents a cadet's dismissal from the academy on conduct, integrity, attendance, safety, or administrative grounds (not academic failure), with appeal rights and property return.",
    reSubject: 'Dismissal from Academy — Conduct / Administrative Grounds',
    fields: [
      { key: 'effectiveDate', label: 'Effective Date of Dismissal', type: 'date', required: true, hint: 'The date the dismissal takes effect' },
      { key: 'grounds', label: 'Grounds for Dismissal (factual basis)', type: 'textarea', required: true, hint: 'State the specific facts: what occurred, when, and how it was observed or established' },
      { key: 'policyBasis', label: 'Policy / Standard Basis', type: 'text', required: true, hint: 'The academy standard or manual section relied upon, e.g. "Academy Cadet Manual, Code of Conduct"' },
      { key: 'priorActions', label: 'Prior Discipline / Counseling', type: 'textarea', required: true, hint: 'Summarize prior counseling, warnings, or discipline, with dates; enter "None" if there were none' },
      { key: 'noticeDeliveryMethod', label: 'Method of Notice Delivery', type: 'select', required: true, hint: 'How this notice is delivered to the cadet; this fixes the start of the appeal period', options: ['Delivered in person', 'Sent by certified mail', "Sent by email to cadet's academy address", 'Other (specify in record)'] },
      { key: 'sponsoringAgency', label: 'Sponsoring Agency', type: 'text', required: true, hint: 'Name of the cadet\'s sponsoring agency, if any; enter "None / Self-sponsored" if not applicable' },
      { key: 'sponsorContact', label: 'Sponsoring Agency Contact', type: 'text', hint: 'Name/title of the agency liaison copied on this notice; leave blank if self-sponsored' },
      { key: 'returnLocation', label: 'Property Return Office / Custodian', type: 'text', required: true, hint: 'Where and to whom academy property must be returned' },
      // Appeal terms MUST be concrete in a real dismissal notice (due process) —
      // they are filled per-notice, never boilerplate.
      { key: 'appealAuthority', label: 'Appeal Authority / Office', type: 'text', required: true, hint: 'Who receives the written appeal, e.g. "Office of the Academy Director"' },
      { key: 'appealDays', label: 'Appeal Deadline (days after receipt)', type: 'number', required: true, hint: "Calendar days after receipt of this notice to submit a written appeal, per your academy's procedure" },
    ],
    document: {
      appliesTo: 'cadet',
      headerFields: [
        { label: 'To:', value: '{cadetName}' },
        { label: 'From:', value: '{directorName}, Academy Director' },
        // CC the sponsoring-agency liaison when present; the row is dropped by the
        // renderer when self-sponsored (sponsorContact blank).
        { label: 'CC:', value: '{sponsorContact}' },
        { label: 'Date:', value: '{memoDate}' },
        { label: 'Re:', value: '{reSubject}' },
      ],
      blocks: [
        { kind: 'paragraph', text: `This memorandum provides written notice that you are dismissed from the training academy, effective {effectiveDate}. This action is taken on conduct, integrity, attendance, safety, or administrative grounds and is separate and distinct from any academic evaluation of your performance.` },
        { kind: 'paragraph', text: `The factual basis for this dismissal is as follows: {grounds}` },
        { kind: 'paragraph', text: `This action is taken under the applicable academy standard governing cadet conduct and dismissal: {policyBasis}.` },
        { kind: 'paragraph', text: `The following prior counseling, warnings, or disciplinary actions are part of your training record and were considered in this decision: {priorActions}` },
        { kind: 'paragraph', text: `This notice is being delivered to you by the following method: {noticeDeliveryMethod}. Your sponsoring agency of record is {sponsoringAgency}.` },
        { kind: 'paragraph', text: `As of the effective date stated above, you are no longer enrolled as a cadet and are not authorized to participate in academy training activities, to be present in restricted training areas, or to represent yourself as a cadet of this academy.` },
        { kind: 'clause', text: `On or before the effective date of this dismissal, you must return all academy-issued property, equipment, credentials, identification, and access devices in your possession to {returnLocation}. Property not returned by the effective date may be reported to your sponsoring agency and addressed under applicable academy and sponsoring-agency property-recovery procedures. Your sponsoring agency, {sponsoringAgency}, will be notified of this dismissal in accordance with academy practice and any applicable agreement with that agency. This dismissal is an adverse action and does not by itself determine any separate certification, eligibility, or employment consequence, which remain governed by the applicable certifying authority and your sponsoring agency. You retain the right to appeal this dismissal under the academy's review and appeal procedure. To preserve that right, a written appeal must be submitted to {appealAuthority} no later than {appealDays} calendar days following your receipt of this notice. The facts stated in this memorandum are recorded contemporaneously and, to the best of the issuing authority's knowledge, are true and accurate. This document is intended to become part of your permanent training record.` },
      ],
      signerLine: '{directorName}, Academy Director',
      acknowledgment: 'My signature below acknowledges that I have received this notice of dismissal on the date indicated. My signature confirms receipt only and does not constitute agreement with, or waiver of any right to appeal, the action described above.',
      ackSignerLabel: 'Cadet',
      distribution: ['Cadet', 'Student File', '{directorName}, Academy Director', 'Training File', '{sponsoringAgency}'],
    },
  },
  {
    id: 'cadet_acknowledgment',
    name: 'Cadet Acknowledgment',
    purpose: 'A cadet signs to confirm receipt and understanding of a policy, manual, safety rules, equipment, or directive, witnessed by an instructor.',
    reSubject: 'Acknowledgment of Receipt and Understanding — {subject}',
    fields: [
      { key: 'subject', label: 'Subject Being Acknowledged', type: 'text', required: true, hint: 'e.g., Cadet Manual, Firearms Safety Rules, Attendance Policy, issued equipment' },
      { key: 'statement', label: 'Acknowledgment Statement', type: 'textarea', required: true, hint: 'Pre-filled with a generic attestation; tailor it to the subject.', default: 'I confirm I have received and/or been briefed on the subject identified above, have read and understand its contents, and agree to comply with its terms throughout my training.' },
      { key: 'addendum', label: 'Subject-Specific Terms (optional)', type: 'textarea', hint: 'Use only if the subject needs added terms, e.g., for issued equipment: "Cadet agrees to maintain the issued items in good condition and return all items on demand or upon separation from the academy."' },
      { key: 'dateAcknowledged', label: 'Date Acknowledged', type: 'date', required: true, hint: 'Date the cadet signs and acknowledges' },
    ],
    document: {
      appliesTo: 'cadet',
      headerFields: [
        { label: 'To:', value: '{cadetName}, Cadet' },
        { label: 'From:', value: '{fromName}, Witnessing Instructor' },
        { label: 'CC:', value: '{directorName}, Academy Director' },
        { label: 'Date:', value: '{memoDate}' },
        { label: 'Re:', value: '{reSubject}' },
      ],
      blocks: [
        { kind: 'paragraph', text: `This document records that on {dateAcknowledged}, Cadet {cadetName} received and/or was briefed on {subject} by the Academy and reviewed its contents. By signing below, the cadet confirms receipt of and familiarity with {subject}, attests that the cadet has read and understands its terms and requirements, and agrees to comply with them throughout the period of training.` },
        { kind: 'paragraph', text: `The acknowledgment statement applicable to this matter reads as follows: {statement}` },
        { kind: 'paragraph', text: `The following subject-specific terms also apply to this acknowledgment, where noted: {addendum}` },
        { kind: 'clause', text: `The cadet understands that {subject} sets forth standards and expectations applicable to participation in the training academy, and that compliance is a condition of continued enrollment. The cadet has had the opportunity to ask questions regarding {subject} and to request clarification of any provision not understood before signing.` },
        { kind: 'clause', text: `The cadet further understands that failure to comply with {subject} may result in corrective or disciplinary action up to and including dismissal from the academy, in accordance with the Academy Cadet Manual and applicable academy policy, and that any such action would be administered through the academy's established process, including any notice and appeal rights provided therein.` },
        { kind: 'clause', text: `By signing, the cadet attests that the information recorded above is true and accurate, that this acknowledgment is given freely on the date indicated, and that this record may be retained in the cadet's permanent training file. This acknowledgment does not waive, limit, or alter any right afforded the cadet under applicable academy policy or law.` },
      ],
      signerLine: '{fromName}, Witnessing Instructor',
      acknowledgment: 'I, {cadetName}, acknowledge that I have received and/or been briefed on {subject}, that I have read and understand it, that I have had the opportunity to ask questions about it, and that I agree to comply with its terms and with any subject-specific terms recorded above. I sign this acknowledgment freely on {dateAcknowledged}.',
      ackSignerLabel: 'Cadet',
      distribution: ['Cadet', 'Student File', '{directorName}, Academy Director'],
    },
  },
];
