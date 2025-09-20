from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Optional
from ortools.sat.python import cp_model
import math

app = FastAPI(title="Timetable Scheduler (OR-Tools)")

# ---------- Input models ----------
class SubjectIn(BaseModel):
    name: str
    credit: int  # theory classes per week (1-3)
    lab: int = 0  # number of lab blocks (each block = 2 periods)

class FacultyIn(BaseModel):
    name: str
    subjects: List[str]  # names of subjects this faculty can teach (1 or 2)

class Payload(BaseModel):
    sectionsCount: int
    theoryRooms: List[str]     # list of theory room identifiers
    labRooms: List[str]        # list of lab room identifiers
    subjectsPerSection: int
    subjects: List[SubjectIn]
    faculty: List[FacultyIn]
    periodsPerDay: int = 8
    breakPeriod: int = 4       # 1-indexed
    workingDays: int = 5

# ---------- Helper ----------
def section_names(n):
    return [chr(ord('A') + i) for i in range(n)]

# ---------- Scheduler endpoint ----------
@app.post("/schedule")
def schedule(payload: Payload):
    # Basic validations
    min_subjects = 4
    max_subjects = max(4, payload.sectionsCount)
    max_periods_per_day = max(6, payload.sectionsCount * 2)
    if not (1 <= payload.sectionsCount <= 6):
        raise HTTPException(status_code=400, detail="sectionsCount must be between 1 and 6.")
    if not (6 <= payload.periodsPerDay <= max_periods_per_day):
        raise HTTPException(status_code=400, detail=f"periodsPerDay must be between 6 and {max_periods_per_day} for {payload.sectionsCount} sections.")
    if not (min_subjects <= len(payload.subjects) <= max_subjects):
        raise HTTPException(status_code=400, detail=f"For {payload.sectionsCount} sections, the number of subjects must be between {min_subjects} and {max_subjects}.")
    if len(payload.faculty) < len(payload.subjects):
        raise HTTPException(status_code=400, detail="The number of faculty must be at least equal to the number of subjects.")
    for s in payload.subjects:
        if not (1 <= s.credit <= 3):
            raise HTTPException(status_code=400, detail="subject credit must be 1..3")
        if s.lab < 0 or s.lab > 3:
            raise HTTPException(status_code=400, detail="subject lab must be 0..3")
    if len(payload.theoryRooms) < 1:
        raise HTTPException(status_code=400, detail="need at least one theory room")
    if len(payload.labRooms) < 1:
        raise HTTPException(status_code=400, detail="need at least one lab room")

    # indexing helpers
    S = payload.sectionsCount
    sections = section_names(S)
    subj_list = [s.name for s in payload.subjects]
    subj_index = {name: i for i, name in enumerate(subj_list)}
    F = len(payload.faculty)
    faculty_list = [f.name for f in payload.faculty]
    # for fast lookup: for each subject, list of faculties who can teach it
    subj_to_facs = {s: [] for s in subj_list}
    for fi, f in enumerate(payload.faculty):
        for sname in f.subjects:
            if sname in subj_to_facs:
                subj_to_facs[sname].append(fi)

    D = payload.workingDays
    P = payload.periodsPerDay
    brk = payload.breakPeriod - 1  # zero-index break period

    T_rooms = payload.theoryRooms
    L_rooms = payload.labRooms
    T = len(T_rooms)
    L = len(L_rooms)

    # Build CP-SAT model
    model = cp_model.CpModel()

    # Variables:
    # x[s,sub,d,p] = theory class for section s, subject sub at day d period p
    x = {}
    for si in range(S):
        for subi in range(len(subj_list)):
            for d in range(D):
                for p in range(P):
                    if p == brk:
                        continue
                    x[(si, subi, d, p)] = model.NewBoolVar(f"x_s{si}_u{subi}_d{d}_p{p}")

    # lstart[s,sub,d,p] = lab block start at period p (occupies p and p+1)
    lstart = {}
    for si in range(S):
        for subi in range(len(subj_list)):
            for d in range(D):
                for p in range(P - 1):  # cannot start at last period
                    if p == brk or (p + 1) == brk:
                        continue
                    lstart[(si, subi, d, p)] = model.NewBoolVar(f"l_s{si}_u{subi}_d{d}_p{p}")

    # room assignment variables (theory): r_th[s,sub,d,p,tr]
    r_th = {}
    for si in range(S):
        for subi in range(len(subj_list)):
            for d in range(D):
                for p in range(P):
                    if p == brk: continue
                    for tr in range(T):
                        r_th[(si, subi, d, p, tr)] = model.NewBoolVar(f"rth_s{si}_u{subi}_d{d}_p{p}_tr{tr}")

    # room assignment variables for lab starts: r_lab[s,sub,d,p,lr]
    r_lab = {}
    for si in range(S):
        for subi in range(len(subj_list)):
            for d in range(D):
                for p in range(P - 1):
                    if p == brk or (p + 1) == brk: continue
                    for lr in range(L):
                        r_lab[(si, subi, d, p, lr)] = model.NewBoolVar(f"rlab_s{si}_u{subi}_d{d}_p{p}_lr{lr}")

    # faculty assignment variables for theory: f_th[s,sub,d,p,fid]
    f_th = {}
    for si in range(S):
        for subi, sname in enumerate(subj_list):
            facs = subj_to_facs[sname]
            for d in range(D):
                for p in range(P):
                    if p == brk: continue
                    for fid in facs:
                        f_th[(si, subi, d, p, fid)] = model.NewBoolVar(f"fth_s{si}_u{subi}_d{d}_p{p}_f{fid}")

    # faculty assignment variables for lab starts: f_lab[s,sub,d,p,fid]
    f_lab = {}
    for si in range(S):
        for subi, sname in enumerate(subj_list):
            facs = subj_to_facs[sname]
            for d in range(D):
                for p in range(P - 1):
                    if p == brk or (p + 1) == brk: continue
                    for fid in facs:
                        f_lab[(si, subi, d, p, fid)] = model.NewBoolVar(f"flab_s{si}_u{subi}_d{d}_p{p}_f{fid}")

    # ---------- Linking constraints ----------

    # Link theory class with exactly one faculty and exactly one theory room when x==1
    for si in range(S):
        for subi, sname in enumerate(subj_list):
            facs = subj_to_facs[sname]
            for d in range(D):
                for p in range(P):
                    if p == brk: continue
                    xi = x[(si, subi, d, p)]
                    # sum faculties == xi
                    if facs:
                        model.Add(sum(f_th[(si, subi, d, p, fid)] for fid in facs) == xi)
                    else:
                        # no faculty can teach this subject -> infeasible
                        model.Add(xi == 0)
                    # sum theory rooms == xi
                    model.Add(sum(r_th[(si, subi, d, p, tr)] for tr in range(T)) == xi)

    # Link lab start with exactly one faculty and exactly one lab room when lstart==1
    for si in range(S):
        for subi, sname in enumerate(subj_list):
            facs = subj_to_facs[sname]
            for d in range(D):
                for p in range(P - 1):
                    if p == brk or (p + 1) == brk: continue
                    li = lstart[(si, subi, d, p)]
                    if facs:
                        model.Add(sum(f_lab[(si, subi, d, p, fid)] for fid in facs) == li)
                    else:
                        model.Add(li == 0)
                    model.Add(sum(r_lab[(si, subi, d, p, lr)] for lr in range(L)) == li)

    # A lab start occupying p and p+1 must forbid theory or other labs for that section at those periods
    # We'll enforce section occupancy constraints globally below.

    # ---------- Demand constraints ----------

    # For each section and subject theory: total assigned theory slots == credit
    for si in range(S):
        for subi, subj in enumerate(payload.subjects):
            needed = subj.credit
            model.Add(sum(
                x[(si, subi, d, p)]
                for d in range(D)
                for p in range(P)
                if p != brk
            ) == needed)

    # For each section and subject lab: total lab starts == lab count
    for si in range(S):
        for subi, subj in enumerate(payload.subjects):
            needed_labs = subj.lab
            model.Add(sum(
                lstart[(si, subi, d, p)]
                for d in range(D)
                for p in range(P - 1)
                if p != brk and (p + 1) != brk
            ) == needed_labs)

    # ---------- Section occupancy constraints ----------
    # For each section, day, period: sum of theory classes + labs occupying that period <= 1
    for si in range(S):
        for d in range(D):
            for p in range(P):
                if p == brk: continue
                # theory assignments at (si,d,p)
                theory_at = [x[(si, subi, d, p)] for subi in range(len(subj_list))]
                # labs that occupy p: lab starts at p or lab starts at p-1
                labs_occupying = []
                if p < P - 1 and (p != brk and (p + 1) != brk):
                    # lab starting at p occupies p
                    labs_occupying += [lstart[(si, subi, d, p)] for subi in range(len(subj_list)) if (si, subi, d, p) in lstart]
                if p - 1 >= 0 and (p != brk and (p - 1) != brk):
                    # lab starting at p-1 occupies p
                    if (p - 1) < P - 1:
                        labs_occupying += [lstart[(si, subi, d, p - 1)] for subi in range(len(subj_list)) if (si, subi, d, p - 1) in lstart]
                if theory_at or labs_occupying:
                    model.Add(sum(theory_at + labs_occupying) <= 1)

    # ---------- Faculty conflict constraints ----------
    # For each faculty fid, each day d, period p: sum of classes where this faculty is assigned at (d,p) <= 1
    for fid in range(F):
        for d in range(D):
            for p in range(P):
                if p == brk: continue
                terms = []
                # theory assignments where f_th == 1
                for si in range(S):
                    for subi, sname in enumerate(subj_list):
                        facs = subj_to_facs[sname]
                        if fid in facs:
                            key = (si, subi, d, p, fid)
                            if key in f_th:
                                terms.append(f_th[key])
                # labs occupying p: need to include lab starts at p and p-1 with f_lab chosen
                for si in range(S):
                    for subi, sname in enumerate(subj_list):
                        facs = subj_to_facs[sname]
                        if fid in facs:
                            # lab starting at p
                            key1 = (si, subi, d, p, fid)
                            if key1 in f_lab:
                                terms.append(f_lab[key1])
                            # lab starting at p-1 (occupies p)
                            key0 = (si, subi, d, p - 1, fid)
                            if key0 in f_lab:
                                terms.append(f_lab[key0])
                if terms:
                    model.Add(sum(terms) <= 1)

    # ---------- Room conflict constraints ----------
    # For theory rooms: for each theory room tr, day d, p: sum of r_th[...] <= 1
    for tr in range(T):
        for d in range(D):
            for p in range(P):
                if p == brk: continue
                model.Add(sum(
                    r_th[(si, subi, d, p, tr)]
                    for si in range(S)
                    for subi in range(len(subj_list))
                ) <= 1)

    # For lab rooms: a lab starting at p occupies p and p+1 in that lab room
    for lr in range(L):
        for d in range(D):
            for p in range(P):
                if p == brk: continue
                # collect lab starts that occupy this p (start at p or start at p-1)
                terms = []
                for si in range(S):
                    for subi in range(len(subj_list)):
                        # start at p
                        key1 = (si, subi, d, p, lr)
                        if key1 in r_lab:
                            terms.append(r_lab[key1])
                        # start at p-1 (then occupies p)
                        key0 = (si, subi, d, p - 1, lr)
                        if key0 in r_lab:
                            terms.append(r_lab[key0])
                if terms:
                    model.Add(sum(terms) <= 1)

    # ---------- Prevent using same room for theory & lab at same time ----------
    # If desirable, ensure that total number of classes (theory assigned to some theory room + labs occupying a lab room) is unconstrained across different room pools.
    # (We assume theory rooms and lab rooms are distinct pools.)

    # ---------- Optional: simple symmetry breaking (try to prefer earlier periods) ----------
    # Not necessary for correctness, omitted to keep model simpler.

    # ---------- Solve ----------
    solver = cp_model.CpSolver()
    # Tune parameters for feasibility search
    solver.parameters.max_time_in_seconds = 30.0  # adjust if needed
    solver.parameters.num_search_workers = 8

    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise HTTPException(status_code=500, detail="No feasible timetable found with given constraints. Try adjusting inputs (more rooms/faculty/periods).")

    # ---------- Build response schedule ----------
    # The new structure will be a dictionary keyed by section name.
    schedules = {section: {"days": []} for section in sections}
    days_names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][:D]

    for si, section_name in enumerate(sections):
        current_section_days = []
        for d, day_name in enumerate(days_names):
            day_periods = [None] * P
            for p in range(P):
                if p == brk:
                    day_periods[p] = {"break": True}
                    continue

                assigned_class = None

                # Check for theory class for this section (si)
                for subi, sname in enumerate(subj_list):
                    key = (si, subi, d, p)
                    if key in x and solver.Value(x[key]) == 1:
                        room_assigned = next((T_rooms[tr] for tr in range(T) if solver.Value(r_th.get((si, subi, d, p, tr), 0)) == 1), None)
                        facs = subj_to_facs.get(sname, [])
                        fac_assigned = next((faculty_list[fid] for fid in facs if solver.Value(f_th.get((si, subi, d, p, fid), 0)) == 1), None)
                        assigned_class = {"section": section_name, "subject": sname, "isLab": False, "room": room_assigned, "faculty": fac_assigned}
                        break

                if assigned_class:
                    day_periods[p] = assigned_class
                    continue

                # Check for lab class for this section (si)
                for subi, sname in enumerate(subj_list):
                    # Lab starting at p
                    if (si, subi, d, p) in lstart and solver.Value(lstart[(si, subi, d, p)]) == 1:
                        lr_assigned = next((L_rooms[lr] for lr in range(L) if solver.Value(r_lab.get((si, subi, d, p, lr), 0)) == 1), None)
                        facs = subj_to_facs.get(sname, [])
                        fac_assigned = next((faculty_list[fid] for fid in facs if solver.Value(f_lab.get((si, subi, d, p, fid), 0)) == 1), None)
                        assigned_class = {"section": section_name, "subject": sname, "isLab": True, "room": lr_assigned, "faculty": fac_assigned, "note": "lab start"}
                        break

                    # Lab continuing from p-1
                    if p > 0 and (si, subi, d, p - 1) in lstart and solver.Value(lstart[(si, subi, d, p - 1)]) == 1:
                        lr_assigned = next((L_rooms[lr] for lr in range(L) if solver.Value(r_lab.get((si, subi, d, p - 1, lr), 0)) == 1), None)
                        facs = subj_to_facs.get(sname, [])
                        fac_assigned = next((faculty_list[fid] for fid in facs if solver.Value(f_lab.get((si, subi, d, p - 1, fid), 0)) == 1), None)
                        assigned_class = {"section": section_name, "subject": sname, "isLab": True, "room": lr_assigned, "faculty": fac_assigned, "note": "lab cont."}
                        break

                day_periods[p] = assigned_class

            current_section_days.append({"day": day_name, "periods": day_periods})
        schedules[section_name]["days"] = current_section_days

    # The final response structure is now much cleaner and more useful for the frontend.
    return {
        "schedules": schedules,
        "periodsPerDay": P,
        "breakPeriod": brk + 1,
        "theoryRooms": T_rooms,
        "labRooms": L_rooms,
        "sections": sections,
        "faculty": faculty_list,
        "subjects": payload.subjects,
    }