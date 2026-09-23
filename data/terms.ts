// AusDilaps General Terms and Conditions, version 2.0 (see data/legal.ts).
//
// Version 1 (7 June 2023) with these changes only: the correct contracting entity;
// order of precedence (4.5); the Site Records clause (13.7); its confidentiality
// carve-out (14.2(e)); Site Records retention (18.4); the privacy clause (20.13); and
// typo / cross-reference fixes (e.g. 8.3, 10.4, 18.3(c)). Everything else is verbatim.
// Inline **bold** and [links](/path) render through renderInline().

export type TermsItem = { label: string; text: string; items?: TermsItem[] };

export type TermsClause = {
  number?: string;
  text?: string;
  items?: TermsItem[];
  /** Text that closes a clause after its list, e.g. "in accordance with the Payment Terms." */
  after?: string;
};

export type TermsSection = { number: string; title: string; clauses: TermsClause[] };

export const TERMS_PREAMBLE =
  "This Agreement is entered into between **Urban Pulse Strategies Pty Ltd ACN 650 700 226 trading as AusDilaps** (**Group Company**, **we**, **us** and **our**) and **you**, the entity or individual that requests our Services (**you** or **your**), together the **Parties** and each a **Party**.";

export const TERMS_SECTIONS: TermsSection[] = [
  {
    number: "1",
    title: "Acceptance and Term",
    clauses: [
      {
        number: "1.1",
        text: "You accept this Agreement by the earlier of:",
        items: [
          { label: "(a)", text: "signing and returning this Agreement to us;" },
          { label: "(b)", text: "confirming by email that you accept this Agreement;" },
          {
            label: "(c)",
            text: "confirming that you accept this Agreement via the platforms or applications through which we provide this Agreement to you, including our website;",
          },
          { label: "(d)", text: "instructing us (in writing) to proceed with the provision of the Services; and" },
          { label: "(e)", text: "making part or full payment of the Price." },
        ],
      },
      { number: "1.2", text: "This Agreement will commence on the Commencement Date and will continue for the Term." },
    ],
  },
  {
    number: "2",
    title: "Services",
    clauses: [
      {
        number: "2.1",
        text: "In consideration of your payment of the Price, we will provide the Services in accordance with this Agreement, whether ourselves or through our Personnel.",
      },
    ],
  },
  {
    number: "3",
    title: "Commencement",
    clauses: [
      {
        text: "We will commence the provision of the Services within a reasonable time after the later of:",
        items: [
          { label: "(a)", text: "the Commencement Date;" },
          { label: "(b)", text: "if applicable, payment of the Price; and" },
          {
            label: "(c)",
            text: "to the extent any Project Brief is required, the Project Brief (and any relevant subsequent information) is received (as reasonably determined by us).",
          },
        ],
      },
    ],
  },
  {
    number: "4",
    title: "Orders",
    clauses: [
      {
        number: "4.1",
        text: "This Agreement constitutes a “standing offer” under which, during the Term, you may engage us to provide the Services under separate Orders.",
      },
      {
        number: "4.2",
        text: "You may issue Orders online, over the phone or by any other process which we may advise to you, from time to time.",
      },
      {
        number: "4.3",
        text: "We will only be required to comply with an Order if we have agreed to the terms of the relevant Order in writing, if we have accepted the Order in accordance with the terms of the Order, or if the Parties have agreed in writing to an amended Order.",
      },
      {
        number: "4.4",
        text: "The Order issued by you, may be accepted by one of our Related Entities. If one of our Related Entities accepts the Order, that Related Entity will be set out in the Order and references to “we”, “us”, “our” and “Party” or “Parties” as used throughout this Agreement, shall mean that Related Entity set out in the Order and not the Group Company. The Related Entity will be responsible for performing the Services under the Order and the Group Company will not be a party to that Order.",
      },
      {
        number: "4.5",
        text: "Each Order is subject to, and will be governed by, this Agreement and any other conditions agreed to by the Parties in writing. If the documents forming this Agreement are inconsistent, they apply in this order (highest first):",
        items: [
          { label: "(a)", text: "any written agreement for the Services signed by both Parties;" },
          { label: "(b)", text: "our quote, including its terms and conditions; and" },
          { label: "(c)", text: "these terms." },
        ],
        after:
          "Terms in or referred to in your purchase order or any other document apply only if we agree to them in writing.",
      },
      {
        number: "4.6",
        text: "Unless otherwise agreed between the Parties, if this Agreement is terminated, then any current Order will also terminate on the date of termination.",
      },
    ],
  },
  {
    number: "5",
    title: "Variations",
    clauses: [
      {
        number: "5.1",
        text: "Subject to clause 5.3, either Party may request a variation or change to the Services, including the timing for the provision of the Services, by providing written notice (including by email) to the other Party, with details of the variation or change (**Variation Request**).",
      },
      {
        number: "5.2",
        text: "If you provide us with a Variation Request, we will not be obliged to comply with a Variation Request unless:",
        items: [
          {
            label: "(a)",
            text: "we accept the Variation Request, including any variation to the Price to effect the Variation Request (**Price Variation**), in writing; and",
          },
          { label: "(b)", text: "the Price has been adjusted to reflect the Price Variation." },
        ],
      },
      {
        number: "5.3",
        text: "If we provide you with a Variation Request, we will set out any relevant Price Variation in the Variation Request.",
      },
      {
        number: "5.4",
        text: "If we consider that any instruction or direction from you constitutes a variation, then we will not be obliged to comply with such instruction or direction unless a Variation Request has been issued in accordance with clause 5.2.",
      },
      {
        number: "5.5",
        text: "Where the Services are varied or changed, or the costs of providing the Services increase (**Variation Event**), and the cause of that Variation Event relates to, or is connected with, an event or circumstance beyond our reasonable control, you agree to pay us our reasonable additional costs and expenses that we may suffer or incur as a result of the Variation Event, as a debt due and immediately payable.",
      },
    ],
  },
  {
    number: "6",
    title: "Delays",
    clauses: [
      {
        number: "6.1",
        text: "If we are delayed in carrying out the Services by a cause beyond our reasonable control or by your act or omission or by an act or omission of one of your Personnel then the time for carrying out the Services shall be extended to the extent of the delay and you shall pay the costs incurred by us by reason of the delay. Nothing in this clause shall oblige you to pay for costs for a delay which have already been included in the Price or in an agreed Price Variation.",
      },
    ],
  },
  {
    number: "7",
    title: "Your Obligations",
    clauses: [
      {
        text: "You agree to:",
        items: [
          {
            label: "(a)",
            text: "comply with this Agreement, our reasonable requests or requirements, and all applicable Laws; and",
          },
          {
            label: "(b)",
            text: "provide all assistance, information, briefings, instructions, designs, documentation, access, facilities, authorities, consents, licences and permissions reasonably necessary to enable us to comply with our obligations under this Agreement or at Law.",
          },
        ],
      },
    ],
  },
  {
    number: "8",
    title: "Payment",
    clauses: [
      {
        number: "8.1",
        text: "You agree to pay us:",
        items: [
          { label: "(a)", text: "the Price;" },
          { label: "(b)", text: "all Expenses not included in the Price; and" },
          { label: "(c)", text: "any other amount payable to us under this Agreement," },
        ],
        after: "in accordance with the Payment Terms.",
      },
      {
        number: "8.2",
        text: "If any payment has not been made in accordance with the Payment Terms, we may (at our absolute discretion):",
        items: [
          {
            label: "(a)",
            text: "immediately cease providing the Services, and recover, as a debt due and immediately payable from you, the payment amount and our additional costs of doing so; and/or",
          },
          {
            label: "(b)",
            text: "charge interest at a rate equal to the Reserve Bank of Australia’s cash rate, from time to time, plus 8% per annum, calculated daily and compounding monthly, on any such amounts unpaid after the due date for payment in accordance with the Payment Terms.",
          },
        ],
      },
      {
        number: "8.3",
        text: "**Costs and Expenses:** You agree to indemnify us for any costs, expenses, liabilities or claims paid or incurred by us as a result of a breach of this Agreement by you. Without limiting the generality of the foregoing, you agree to pay to us on demand any costs or expenses (including legal costs and expenses on a full indemnity basis) incurred by us as a result of a breach by you of this Agreement.",
      },
    ],
  },
  {
    number: "9",
    title: "Premises",
    clauses: [
      {
        text: "You agree to provide us (and our Personnel) with unfettered access to the Premises (and the facilities at the Premises), and any other premises reasonably necessary for us to provide the Services, free from harm or risk to health or safety:",
        items: [
          { label: "(a)", text: "at the times and on the dates requested by us; and/or" },
          { label: "(b)", text: "to enable us to comply with our obligations under this Agreement or at Law," },
        ],
        after:
          "and you agree to pay us any additional costs that we may suffer or incur if you fail to do so, as a debt due and immediately payable to us.",
      },
    ],
  },
  {
    number: "10",
    title: "Inspections",
    clauses: [
      {
        number: "10.1",
        text: "We may conduct inspections on the Premises in order to carry out the Services. You acknowledge that our Services are based on visual inspections only.",
      },
      {
        number: "10.2",
        text: "Despite anything to the contrary, to the maximum extent permitted by law, we will not be liable for, you waive and release us from and against, and you agree to indemnify us from any Liability in connection with:",
        items: [
          { label: "(a)", text: "matters arising outside of the visual inspections;" },
          {
            label: "(b)",
            text: "matters arising that relate to information that was available after the date of the visual inspection;",
          },
          { label: "(c)", text: "pre-existing deterioration or damage to the building that becomes known in the future;" },
          { label: "(d)", text: "matters outside the scope of the agreed Services;" },
          { label: "(e)", text: "areas that were inaccessible at the time of the visual inspection; and" },
          { label: "(f)", text: "any electrical or mechanical matters." },
        ],
      },
      {
        number: "10.3",
        text: "When undertaking visual inspections, you agree that we may be bound to comply with applicable Laws, including, but not limited to, privacy laws, or contractual obligations. We will not be obliged to do anything under this Agreement which may not be permitted under the applicable Laws or that we have no express right to do, such as disclosing information that is not owned by us.",
      },
      {
        number: "10.4",
        text: "If an inspection is rescheduled without fault on our part, you agree to pay us any costs wasted by us as a result, as well as a rescheduling fee equivalent to AUD$500, on demand.",
      },
      {
        number: "10.5",
        text: "By engaging AusDilaps to carry out a condition survey at a residential or commercial property, you recognise and accept that we retain the right, at our sole discretion, to provide the property owner(s) with a copy of the inspection report(s), should they request it.",
      },
    ],
  },
  {
    number: "11",
    title: "Warranties",
    clauses: [
      {
        text: "You represent, warrant and agree that:",
        items: [
          { label: "(a)", text: "there are no legal restrictions preventing you from entering into this Agreement;" },
          {
            label: "(b)",
            text: "all information and documentation that you provide to us in connection with this Agreement is true, correct and complete;",
          },
          {
            label: "(c)",
            text: "you have not relied on any representations or warranties made by us in relation to the Services (including as to whether the Services are or will be fit or suitable for your particular purposes), unless expressly stipulated in this Agreement;",
          },
          {
            label: "(d)",
            text: "the Services are provided to you solely for your benefit and you will not (or you will not attempt to) disclose, provide access to, our Services to third parties without our prior written consent (and that there is to be no third party reliance on the Services);",
          },
          {
            label: "(e)",
            text: "any information, advice, material, work and services (including the Services) provided by us under this Agreement does not constitute legal, financial, merger, due diligence or risk management advice;",
          },
          { label: "(f)", text: "you are not and have not been the subject of an Insolvency Event;" },
          { label: "(g)", text: "if applicable, you hold a valid ABN which has been advised to us; and" },
          { label: "(h)", text: "if applicable, you are registered for GST purposes." },
        ],
      },
    ],
  },
  {
    number: "12",
    title: "Indemnities",
    clauses: [
      {
        number: "12.1",
        text: "You agree to indemnify us for any Liability for any claim arising from or in connection with you disclosing, or providing access to, our Services (including any Deliverables) to third parties without our written consent. For the avoidance of doubt, the indemnity in this clause 12 extends to any Liability for any claim arising from or in connection with a third party’s reliance on our Services (including any Deliverables).",
      },
      { number: "12.2", text: "This clause 12 will survive termination or expiry of this Agreement." },
    ],
  },
  {
    number: "13",
    title: "Intellectual Property",
    clauses: [
      {
        number: "13.1",
        text: "As between the Parties:",
        items: [
          { label: "(a)", text: "we own all Intellectual Property Rights in Our Materials;" },
          { label: "(b)", text: "you own all Intellectual Property Rights in Your Materials; and" },
          {
            label: "(c)",
            text: "nothing in this Agreement constitutes a transfer or assignment of any Intellectual Property Rights in Our Materials or Your Materials.",
          },
        ],
      },
      {
        number: "13.2",
        text: "As between the Parties, ownership of all Intellectual Property Rights in any New Materials will at all times vest, or remain vested, in us upon creation. To the extent that ownership of such Intellectual Property Rights in any New Materials do not automatically vest in us, you agree to do all things necessary or desirable to assure our title to such rights.",
      },
      {
        number: "13.3",
        text: "We grant you a non-exclusive, revocable, worldwide, non-sublicensable and non-transferable right and licence, to use the New Materials, solely for the purposes for which they were developed and for your use and enjoyment of the Services, as contemplated by this Agreement.",
      },
      {
        number: "13.4",
        text: "You grant us a non-exclusive, revocable, worldwide, non-sublicensable and non-transferable right and licence, for the duration of the Term, to use Your Materials solely for the purposes for which they were developed and for the performance of our obligations under this Agreement (or under the relevant Order), as contemplated by this Agreement.",
      },
      {
        number: "13.5",
        text: "If you or any of your Personnel have any Moral Rights in any material provided, used or prepared in connection with this Agreement, you agree to (and agree to ensure that your Personnel) consent to our use or infringement of those Moral Rights.",
      },
      {
        number: "13.6",
        text: "In the use of any Intellectual Property Rights in connection with this Agreement, you must not (and you must ensure that your Personnel do not) commit any Intellectual Property Breach.",
      },
      {
        number: "13.7",
        text: "**Site Records** means photographs, video, drone, LiDAR and other imagery, measurements and field notes captured by us or our Personnel in providing the Services. Site Records are New Materials, owned by us under clause 13.2.",
        items: [
          {
            label: "(a)",
            text: "You agree that we may use, reproduce, adapt and supply Site Records, and the factual observations of property condition recorded in them, to prepare reports or provide services to any other person, during or after the Term.",
          },
          {
            label: "(b)",
            text: "When we do so, we will:",
            items: [
              {
                label: "(1)",
                text: "not name you or your project, or include Your Materials or any Confidential Information you have disclosed to us;",
              },
              {
                label: "(2)",
                text: "state the date the Site Records were captured and whether a reinspection has occurred;",
              },
              {
                label: "(3)",
                text: "comply with privacy laws and any request or restriction from the relevant property owner or occupier; and",
              },
              {
                label: "(4)",
                text: "not supply any post-construction comparison, defect origin or other damage assessment prepared for you without your written consent.",
              },
            ],
          },
          {
            label: "(c)",
            text: "You have no liability for, and no rights in, any report we prepare for another person under this clause.",
          },
          {
            label: "(d)",
            text: "This clause applies despite clauses 13.3 and 14. It does not apply to the extent a written agreement signed by both Parties says otherwise, or if you tell us in writing before we accept your Order that you do not agree to it.",
          },
        ],
      },
      { number: "13.8", text: "This clause 13 will survive termination or expiry of this Agreement." },
    ],
  },
  {
    number: "14",
    title: "Confidential Information",
    clauses: [
      {
        number: "14.1",
        text: "Each Receiving Party agrees:",
        items: [
          { label: "(a)", text: "not to disclose the Confidential Information of the Disclosing Party to any third party;" },
          {
            label: "(b)",
            text: "to use all reasonable endeavours to protect the Confidential Information of the Disclosing Party from any unauthorised disclosure; and",
          },
          {
            label: "(c)",
            text: "to only use the Confidential Information of the Disclosing Party for the purposes for which it was disclosed or provided by the Disclosing Party, and not for any other purpose.",
          },
        ],
      },
      {
        number: "14.2",
        text: "The obligations in clause 14.1 do not apply to Confidential Information that:",
        items: [
          {
            label: "(a)",
            text: "is required to be disclosed in order for the Parties to comply with their obligations under this Agreement;",
          },
          { label: "(b)", text: "is authorised to be disclosed by the Disclosing Party;" },
          {
            label: "(c)",
            text: "is in the public domain and/or is no longer confidential, except as a result of a breach of this Agreement;",
          },
          { label: "(d)", text: "must be disclosed by Law or by a regulatory authority, including under subpoena; or" },
          { label: "(e)", text: "is Site Records, or factual observations, used in accordance with clause 13.7." },
        ],
      },
      {
        number: "14.3",
        text: "Each Party agrees that monetary damages may not be an adequate remedy for a breach of this clause 14. A Party is entitled to seek an injunction, or any other remedy available at law or in equity, at its discretion, to protect itself from a breach (or continuing breach) of this clause 14.",
      },
      { number: "14.4", text: "This clause 14 will survive the termination of this Agreement." },
    ],
  },
  {
    number: "15",
    title: "Australian Consumer Law",
    clauses: [
      {
        number: "15.1",
        text: "Certain legislation, including the Australian Consumer Law, and similar consumer protection laws and regulations, may confer you with rights, warranties, guarantees and remedies relating to the provision of the Services by us to you which cannot be excluded, restricted or modified (**Statutory Rights**).",
      },
      {
        number: "15.2",
        text: "If the ACL applies to you as a consumer, nothing in this Agreement excludes your Statutory Rights as a consumer under the ACL. You agree that our Liability for the Services provided to an entity defined as a consumer under the ACL is governed solely by the ACL and this Agreement.",
      },
      {
        number: "15.3",
        text: "Subject to your Statutory Rights, we exclude all express and implied warranties, and all material, work and services (including the Services) are provided to you without warranties of any kind, either express or implied, whether in statute, at Law or on any other basis.",
      },
      { number: "15.4", text: "This clause 15 will survive the termination or expiry of this Agreement." },
    ],
  },
  {
    number: "16",
    title: "Exclusions to liability",
    clauses: [
      {
        number: "16.1",
        text: "Despite anything to the contrary, to the maximum extent permitted by law, we will not be liable for, and you waive and release us from and against, any Liability caused or contributed to by, arising from or connected with:",
        items: [
          { label: "(a)", text: "your or your Personnel’s acts or omissions;" },
          {
            label: "(b)",
            text: "any use or application of the Services by a person or entity other than you, or other than as reasonably contemplated by this Agreement;",
          },
          {
            label: "(c)",
            text: "any works, services, goods, materials or items which do not form part of the Services (as expressed in this Agreement), or which have not been provided by us;",
          },
          { label: "(d)", text: "any Third Party Inputs; and/or" },
          { label: "(e)", text: "any event outside of our reasonable control." },
        ],
      },
      { number: "16.2", text: "This clause 16 will survive the termination or expiry of this Agreement." },
    ],
  },
  {
    number: "17",
    title: "Limitations on liability",
    clauses: [
      {
        number: "17.1",
        text: "Despite anything to the contrary, to the maximum extent permitted by law:",
        items: [
          { label: "(a)", text: "we will not be liable for Consequential Loss;" },
          {
            label: "(b)",
            text: "a Party’s liability for any Liability under this Agreement will be reduced proportionately to the extent the relevant Liability was caused or contributed to by the acts or omissions of the other Party (or any of its Personnel) (including the other Party’s failure to use reasonable efforts to mitigate their loss or damage), or any event or circumstance is beyond the first party’s control; and",
          },
          {
            label: "(c)",
            text: "our aggregate liability for any Liability arising from or in connection with this Agreement will be limited to us resupplying the Services to you or, in our sole discretion, to us repaying you the amount of the Price paid by you to us in respect of the supply of the relevant Services to which the Liability relates.",
          },
        ],
      },
      { number: "17.2", text: "This clause 17 will survive the termination or expiry of this Agreement." },
    ],
  },
  {
    number: "18",
    title: "Termination",
    clauses: [
      { number: "18.1", text: "We may terminate this Agreement or the relevant Order at any time by giving 30 days’ notice in writing to you." },
      {
        number: "18.2",
        text: "This Agreement will terminate immediately upon written notice by:",
        items: [
          {
            label: "(a)",
            text: "us, if:",
            items: [
              {
                label: "(1)",
                text: "you (or any of your Personnel) breach any provision of this Agreement and that breach has not been remedied within 10 Business Days of being notified by us;",
              },
              {
                label: "(2)",
                text: "you fail to provide us with clear or timely instructions or information to enable us to provide the Services;",
              },
              {
                label: "(3)",
                text: "for any other reason outside our control which has the effect of compromising our ability to provide the Services; or",
              },
              { label: "(4)", text: "you are unable to pay your debts as they fall due; and" },
            ],
          },
          {
            label: "(b)",
            text: "you, if we:",
            items: [
              {
                label: "(1)",
                text: "are in breach of a material term of this Agreement, and that breach has not been remedied within 10 Business Days of being notified by you; or",
              },
              { label: "(2)", text: "are unable to pay our debts as they fall due." },
            ],
          },
        ],
      },
      {
        number: "18.3",
        text: "Upon expiry or termination of this Agreement:",
        items: [
          { label: "(a)", text: "we will immediately cease providing the Services;" },
          {
            label: "(b)",
            text: "you agree that any payments made by you to us are not refundable to you, and you are to pay for all Services provided prior to termination, including Services which have been provided and have not yet been invoiced to you, and all other amounts due and payable under this Agreement; and",
          },
          {
            label: "(c)",
            text: "if this Agreement is terminated under clause 18.2(a)(1), (2) or (4), you also agree to pay us our additional costs arising from, or in connection with, such termination.",
          },
        ],
      },
      {
        number: "18.4",
        text: "We will retain your documents (including copies) as required by law or regulatory requirements. Your express or implied agreement to this Agreement constitutes your authority for us to retain or destroy documents in accordance with the statutory periods, or on expiry or termination of this Agreement. We also retain Site Records for as long as they are reasonably needed for the purposes in clause 13.7 and to deal with claims about the condition of a property, and then securely destroy or de-identify them.",
      },
      {
        number: "18.5",
        text: "Termination of this Agreement will not affect any rights or liabilities that a Party has accrued under it.",
      },
      { number: "18.6", text: "This clause 18 will survive the termination or expiry of this Agreement." },
    ],
  },
  {
    number: "19",
    title: "GST",
    clauses: [
      {
        number: "19.1",
        text: "If GST is payable on any supply made under this Agreement, the recipient of the supply must pay an amount equal to the GST payable on the supply. That amount must be paid at the same time that the consideration is to be provided under this Agreement and must be paid in addition to the consideration expressed elsewhere in this Agreement, unless it is expressed to be inclusive of GST. The recipient is not required to pay any GST until the supplier issues a tax invoice for the supply.",
      },
      {
        number: "19.2",
        text: "If an adjustment event arises in respect of any supply made under this Agreement, a corresponding adjustment must be made between the supplier and the recipient in respect of any amount paid by the recipient under this clause, an adjustment note issued if required, and any payments to give effect to the adjustment must be made.",
      },
      {
        number: "19.3",
        text: "If the recipient is required under this Agreement to pay for or reimburse an expense or outgoing of the supplier, or is required to make a payment under an indemnity in respect of an expense or outgoing of the supplier, the amount to be paid by the recipient is to be reduced by the amount of any input tax credit in respect of that expense or outgoing that the supplier is entitled to.",
      },
      {
        number: "19.4",
        text: "The terms “adjustment event”, “consideration”, “GST”, “input tax credit”, “recipient”, “supplier”, “supply”, “taxable supply” and “tax invoice” each has the meaning which it is given in the A New Tax System (Goods and Services Tax) Act 1999 (Cth).",
      },
    ],
  },
  {
    number: "20",
    title: "General",
    clauses: [
      {
        number: "20.1",
        text: "**Amendment:** This Agreement may only be amended by written instrument executed by the Parties.",
      },
      {
        number: "20.2",
        text: "**Assignment:** A Party must not assign or deal with the whole or any part of its rights or obligations under this Agreement without the prior written consent of the other Party (such consent is not to be unreasonably withheld).",
      },
      {
        number: "20.3",
        text: "**Counterparts:** This Agreement may be executed in any number of counterparts that together will form one instrument.",
      },
      {
        number: "20.4",
        text: "**Disputes:** A Party may not commence court proceedings relating to any dispute, controversy or claim arising from, or in connection with, this Agreement (including any question regarding its existence, validity or termination) (**Dispute**) without first meeting with a senior representative of the other Party to seek (in good faith) to resolve the Dispute. If the Parties cannot agree how to resolve the Dispute at that initial meeting, either Party may refer the matter to a mediator. If the Parties cannot agree on who the mediator should be, either Party may ask the Law Society of New South Wales to appoint a mediator. The mediator will decide the time, place and rules for mediation. The Parties agree to attend the mediation in good faith, to seek to resolve the Dispute. The costs of the mediation will be shared equally between the Parties. Nothing in this clause will operate to prevent a Party from seeking urgent injunctive or equitable relief from a court of appropriate jurisdiction.",
      },
      {
        number: "20.5",
        text: "**Email:** You agree that we are able to send electronic mail to you and receive electronic mail from you. You release us from any Liability you may have as a result of any unauthorised copying, recording, reading or interference with that document or information after transmission, for any delay or non-delivery of any document or information and for any damage caused to your system or any files by a transfer.",
      },
      {
        number: "20.6",
        text: "**Entire agreement:** This Agreement contains the entire understanding between the Parties, and supersedes all previous discussions, communications, negotiations, understandings, representations, warranties, commitments and agreements, in respect of its subject matter.",
      },
      {
        number: "20.7",
        text: "**Further assurance:** Each Party must promptly do all things and execute all further instruments necessary to give full force and effect to this Agreement and their obligations under it.",
      },
      {
        number: "20.8",
        text: "**Force Majeure:** We will not be liable for any delay or failure to perform our obligations under this Agreement if such delay is due to any circumstance beyond our reasonable control (including but not limited to epidemics, pandemics, and Government sanctioned restrictions and orders, whether known or unknown at the time of entering into this Agreement).",
      },
      {
        number: "20.9",
        text: "**Governing law:** This Agreement is governed by the laws of New South Wales. Each Party irrevocably and unconditionally submits to the exclusive jurisdiction of the courts operating in New South Wales and any courts entitled to hear appeals from those courts and waives any right to object to proceedings being brought in those courts.",
      },
      { number: "20.10", text: "**Insurance:** We hold applicable insurances to carry out the Services." },
      {
        number: "20.11",
        text: "**Notices:** Any notice given under this Agreement must be in writing addressed to the relevant address last notified by the recipient to the Parties. Any notice may be sent by standard post or email, and will be deemed to have been served on the expiry of 48 hours in the case of post, or at the time of transmission in the case of transmission by email.",
      },
      {
        number: "20.12",
        text: "**Online execution:** This Agreement may be executed by means of such third party online document execution service as we nominate subject to such execution being in accordance with the applicable terms and conditions of that document execution service.",
      },
      {
        number: "20.13",
        text: "**Privacy:** Each Party must comply with the privacy laws that apply to it, including the Privacy Act 1988 (Cth). We handle personal information in accordance with our [Privacy Policy](/privacy-policy). If you give us personal information about another person, such as a property owner’s or occupier’s contact details, you must be entitled to do so. Property owners and occupiers may contact us directly about photographs and records of their property.",
      },
      {
        number: "20.14",
        text: "**Publicity:** Provided we get your consent (such consent not to be unreasonably withheld), you agree that we may advertise or publicise the broad nature of our provision of the Services to you, including on our website or in our promotional material.",
      },
      {
        number: "20.15",
        text: "**Relationship of Parties:** This Agreement is not intended to create a partnership, joint venture, employment or agency relationship between the Parties.",
      },
      {
        number: "20.16",
        text: "**Severance:** If a provision of this Agreement is held to be void, invalid, illegal or unenforceable, that provision is to be read down as narrowly as necessary to allow it to be valid or enforceable, failing which, that provision (or that part of that provision) will be severed from this Agreement without affecting the validity or enforceability of the remainder of that provision or the other provisions in this Agreement.",
      },
    ],
  },
  {
    number: "21",
    title: "Definitions",
    clauses: [
      {
        text: "In this Agreement, unless the context otherwise requires, capitalised terms have the meanings given to them in the Schedule and/or Order, and:",
      },
      {
        text: "**ACL** or **Australian Consumer Law** means the Australian consumer laws set out in Schedule 2 of the Competition and Consumer Act 2010 (Cth), as amended, from time to time.",
      },
      {
        text: "**Agreement** means these terms and conditions and any agreed Order issued under it and any documents attached to, or referred to in, each of them.",
      },
      {
        text: "**Business Day** means a day on which banks are open for general banking business in New South Wales, excluding Saturdays, Sundays and public holidays.",
      },
      { text: "**Commencement Date** means the date this Agreement is executed by the last Party." },
      {
        text: "**Confidential Information** includes information which:",
        items: [
          { label: "(a)", text: "is disclosed to the Receiving Party in connection with this Agreement at any time;" },
          { label: "(b)", text: "is prepared or produced under or in connection with this Agreement at any time;" },
          { label: "(c)", text: "relates to the Disclosing Party’s business, assets or affairs; or" },
          {
            label: "(d)",
            text: "relates to the subject matter of, the terms of and/or any transactions contemplated by this Agreement,",
          },
        ],
        after:
          "whether or not such information or documentation is reduced to a tangible form or marked in writing as “confidential”, and howsoever the Receiving Party receives that information.",
      },
      {
        text: "**Consequential Loss** includes any consequential loss, indirect loss, real or anticipated loss of profit, loss of benefit, loss of revenue, loss of business, loss of goodwill, loss of opportunity, loss of savings, loss of reputation, loss of use and/or loss or corruption of data, whether under statute, contract, equity, tort (including negligence), indemnity or otherwise.",
      },
      {
        text: "**Deliverables** means any materials, goods, items or other deliverables forming part of the Services, as particularised in the Schedule and/or Order.",
      },
      { text: "**Disclosing Party** means the party disclosing Confidential Information to the Receiving Party." },
      {
        text: "**Expenses** means any disbursements, including travel and accommodation costs and third party costs, reasonably and directly incurred by us for the purpose of the provision of the Services.",
      },
      {
        text: "**Insolvency Event** means any of the following events or any analogous event:",
        items: [
          {
            label: "(a)",
            text: "a Party disposes of the whole or any part of the Party’s assets, operations or business other than in the ordinary course of business;",
          },
          { label: "(b)", text: "a Party ceases, or threatens to cease, carrying on business;" },
          { label: "(c)", text: "a Party is unable to pay the Party’s debts as the debts fall due;" },
          {
            label: "(d)",
            text: "any step is taken by a mortgagee to take possession or dispose of the whole or any part of the Party’s assets, operations or business;",
          },
          {
            label: "(e)",
            text: "any step is taken for a party to enter into any arrangement or compromise with, or assignment for the benefit of, a Party’s creditors or any class of a Party’s creditors; or",
          },
          {
            label: "(f)",
            text: "any step is taken to appoint an administrator, receiver, receiver and manager, trustee, provisional liquidator or liquidator of the whole or any part of a Party’s assets, operations or business.",
          },
        ],
      },
      {
        text: "**Intellectual Property** means any designs, drawings, reports, specifications, calculations; copyright, registered or unregistered designs or trade marks, domain names, know-how, inventions, processes, trade secrets or Confidential Information; or circuit layouts, software, computer programs, databases or source codes, including any application, or right to apply, for registration of, and any improvements, enhancements or modifications of, the foregoing.",
      },
      {
        text: "**Intellectual Property Breach** means any breach by you (or any of your Personnel) of any of our Intellectual Property Rights (or any breaches of third party rights including any Intellectual Property Rights of third parties), including, but not limited, to you (or your Personnel):",
        items: [
          { label: "(a)", text: "copying, altering, enhancing, adapting or modifying any of our Intellectual Property;" },
          { label: "(b)", text: "creating derivative works from our Intellectual Property;" },
          {
            label: "(c)",
            text: "providing or disclosing our Intellectual Property to, or allowing our Intellectual Property to be used by, any third party;",
          },
          {
            label: "(d)",
            text: "assigning or transferring any of our Intellectual Property Rights or granting sublicenses of any of our Intellectual Property Rights, except as expressly permitted in this Agreement;",
          },
          {
            label: "(e)",
            text: "reverse engineering or decompiling any of our Intellectual Property Rights, except where permitted by Law; or",
          },
          {
            label: "(f)",
            text: "using or exploiting our Intellectual Property for purposes other than as expressly stated in this Agreement (including, without limitation, using our Intellectual Property for commercial purposes or on-selling our Intellectual Property to third parties).",
          },
        ],
      },
      {
        text: "**Intellectual Property Rights** means for the duration of the rights in any part of the world, any industrial or intellectual property rights, whether registrable or not, including in respect of Intellectual Property.",
      },
      {
        text: "**Laws** means all applicable laws, regulations, codes, guidelines, policies, protocols, consents, approvals, permits and licences, and any requirements or directions given by any person with the authority to bind the relevant Party in connection with this Agreement or the provision of the Services.",
      },
      {
        text: "**Liability** means any expense, cost, liability, loss, damage, claim, notice, entitlement, investigation, demand, proceeding or judgment (whether under statute, contract, equity, tort (including negligence), indemnity or otherwise), howsoever arising, whether direct or indirect and/or whether present, unascertained, future or contingent and whether involving a third party or a Party to this Agreement or otherwise.",
      },
      { text: "**Moral Rights** has the meaning given in the Copyright Act 1968 (Cth)." },
      {
        text: "**New Materials** means all Intellectual Property developed, adapted, modified or created by or on behalf of us or you or any of your or our respective Personnel in connection with this Agreement or the provision of the Services, after the date of this Agreement (and excluding Our Materials).",
      },
      { text: "**Order** means an order placed by you, for the provision of the Services, in accordance with clause 4." },
      {
        text: "**Our Materials** means all work, models, processes, technologies, strategies, materials, information, documentation, specifications and services (including Intellectual Property), owned, licensed, or developed, adapted or modified, by or on behalf of us or our Personnel before the Commencement Date and/or developed by or on behalf of us or our Personnel independently of this Agreement and/or which form an input into a Deliverable which are not provided to you as part of the Deliverables under this Agreement.",
      },
      {
        text: "**Personnel** means, in respect of a Party, any of its employees, consultants, suppliers, subcontractors or agents.",
      },
      { text: "**Price** means the amounts set out in the Schedule and/or Order." },
      {
        text: "**Privacy Policy** means our privacy policy, which is available publicly on our website at [ausdilaps.com.au/privacy-policy](/privacy-policy).",
      },
      { text: "**Receiving Party** means the party receiving Confidential Information from the Disclosing Party." },
      { text: "**Related Entity** means as the term is defined under the Corporations Act 2001 (Cth)." },
      {
        text: "**Services** means the services that we agree to perform under this Agreement (including the provision of any Deliverables), as particularised in the Order.",
      },
      { text: "**Site Records** has the meaning given in clause 13.7." },
      { text: "**Statutory Rights** has the meaning given in clause 15.1." },
      {
        text: "**Term** means the term of this Agreement, commencing on the Commencement Date and ending on the date on which this Agreement is terminated in accordance with its terms.",
      },
      {
        text: "**Third Party Inputs** means third parties or any goods and services provided by third parties, including customers, end users, suppliers, transportation or logistics providers or other subcontractors which the provision of the Services may be contingent on, or impacted by.",
      },
      {
        text: "**Your Materials** means all work, models, processes, technologies, strategies, materials, information, documentation and services (including Intellectual Property), owned, licensed or developed by or on behalf of you or your Personnel before the Commencement Date and/or developed by or on behalf of you or your Personnel independently of this Agreement.",
      },
    ],
  },
  {
    number: "22",
    title: "Interpretation",
    clauses: [
      {
        text: "In this Agreement, unless the context otherwise requires:",
        items: [
          {
            label: "(a)",
            text: "a reference to this Agreement or any other document includes the document, all schedules and all annexures as novated, amended, supplemented, varied or replaced from time to time;",
          },
          {
            label: "(b)",
            text: "a reference to any legislation or law includes subordinate legislation or law and all amendments, consolidations, replacements or re-enactments from time to time;",
          },
          {
            label: "(c)",
            text: "a reference to a natural person includes a body corporate, partnership, joint venture, association, government or statutory body or authority or other legal entity and vice versa;",
          },
          {
            label: "(d)",
            text: "no clause will be interpreted to the disadvantage of a Party merely because that Party drafted the clause or would otherwise benefit from it;",
          },
          {
            label: "(e)",
            text: "a reference to a party (including a Party) to a document includes that party’s executors, administrators, successors, permitted assigns and persons substituted by novation from time to time;",
          },
          {
            label: "(f)",
            text: "a reference to a covenant, obligation or agreement of two or more persons binds or benefits them jointly and severally;",
          },
          { label: "(g)", text: "a reference to time is to local time in New South Wales; and" },
          { label: "(h)", text: "a reference to $ or dollars refers to the currency of Australia from time to time." },
        ],
      },
    ],
  },
];
