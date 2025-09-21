from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Optional
from ortools.sat.python import cp_model
import math

app = FastAPI(title="Timetable Scheduler (OR-Tools)")

class SubjectIn(BaseModel):
    name: str
    code: str = Field(..., min_length=1, max_length=5, description="A unique code for the subject (1-5 characters).")
    credit: int = Field(..., ge=0, le=3, description="Number of theory classes per week (0-3).")
    lab: int = Field(0, ge=0, le=3, description="Number of 2-period lab blocks per week (0-3).")

class SubjectAssignment(BaseModel):
    subjectName: str
    sections: List[str]
    teachesTheory: bool
    teachesLab: bool

class RoomAssignment(BaseModel):
    subjectName: str
    sectionName: str
    roomName: str

class FacultyIn(BaseModel):
    name: str
    abbr: str
    assignments: List[SubjectAssignment]

# ---------- Input models ----------
class Payload(BaseModel):
    sectionsCount: int
    theoryRooms: List[str]     # list of theory room identifiers
    labRooms: List[str]        # list of lab room identifiers
    theoryRoomAssignments: List[RoomAssignment]
    labRoomAssignments: List[RoomAssignment]
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
    if not (1 <= payload.sectionsCount <= 6):
        raise HTTPException(status_code=400, detail="sectionsCount must be between 1 and 6.")
    if not (8 <= payload.periodsPerDay <= 12):
        raise HTTPException(status_code=400, detail="periodsPerDay must be between 8 and 12.")
    if not (4 <= len(payload.subjects) <= 6):
        raise HTTPException(status_code=400, detail="The number of subjects must be between 4 and 6.")
    
    # New validation: ensure every subject in every section has a faculty member assigned.
    sections_list = section_names(payload.sectionsCount)
    for s in payload.subjects:
        for sec in sections_list:
            # Check theory coverage if needed
            if s.credit > 0:
                is_theory_covered = any(
                    any(assign.subjectName == s.name and sec in assign.sections and assign.teachesTheory for assign in f.assignments)
                    for f in payload.faculty
                )
                if not is_theory_covered:
                    raise HTTPException(status_code=400, detail=f"Theory for subject '{s.name}' has no faculty assigned for Section '{sec}'.")

            # Check lab coverage if needed
            if s.lab > 0:
                is_lab_covered = any(
                    any(assign.subjectName == s.name and sec in assign.sections and assign.teachesLab for assign in f.assignments)
                    for f in payload.faculty
                )
                if not is_lab_covered:
                    raise HTTPException(status_code=400, detail=f"Lab for subject '{s.name}' has no faculty assigned for Section '{sec}'.")

    # Validation: ensure no faculty teaches more than 2 unique subjects.
    for f in payload.faculty:
        unique_subjects = {assignment.subjectName for assignment in f.assignments if assignment.subjectName}
        if len(unique_subjects) > 2:
            raise HTTPException(status_code=400, detail=f"Faculty '{f.name}' cannot teach more than 2 unique subjects. Found {len(unique_subjects)}.")

    # Validation: ensure all faculty names are unique (case-insensitive)
    seen_faculty_names = set()
    for f in payload.faculty:
        lower_name = f.name.lower()
        if lower_name in seen_faculty_names:
            raise HTTPException(status_code=400, detail=f"Faculty names must be unique. Found duplicate: '{f.name}'.")
        seen_faculty_names.add(lower_name)

    # Validate that subjects have at least one class
    for s in payload.subjects:
        if s.credit == 0 and s.lab == 0:
            raise HTTPException(status_code=400, detail=f"Subject '{s.name}' must have at least one theory or lab class.")
    if len(payload.theoryRooms) < 1:
        raise HTTPException(status_code=400, detail="need at least one theory room")
    if len(payload.labRooms) < 1:
        raise HTTPException(status_code=400, detail="need at least one lab room")

    # indexing helpers
    S = payload.sectionsCount
    sections = section_names(S)
    section_index = {name: i for i, name in enumerate(sections)}
    subj_list = [s.name for s in payload.subjects]
    subj_index = {name: i for i, name in enumerate(subj_list)}
    F = len(payload.faculty)
    faculty_info = [{'name': f.name, 'abbr': f.abbr} for f in payload.faculty]
    T_rooms = payload.theoryRooms
    L_rooms = payload.labRooms
    T = len(T_rooms)
    L = len(L_rooms)
    theory_room_index = {name: i for i, name in enumerate(T_rooms)}
    lab_room_index = {name: i for i, name in enumerate(L_rooms)}

    # Create assignment maps: (si, subi) -> room_idx
    theory_assignment_map = {}
    for assign in payload.theoryRoomAssignments:
        if assign.subjectName in subj_index and assign.sectionName in section_index and assign.roomName in theory_room_index:
            theory_assignment_map[(section_index[assign.sectionName], subj_index[assign.subjectName])] = theory_room_index[assign.roomName]
    lab_assignment_map = {}
    for assign in payload.labRoomAssignments:
        if assign.subjectName in subj_index and assign.sectionName in section_index and assign.roomName in lab_room_index:
            lab_assignment_map[(section_index[assign.sectionName], subj_index[assign.subjectName])] = lab_room_index[assign.roomName]

    # for fast lookup: for each (subject, section), list of faculties who can teach theory/lab
    subj_section_theory_to_facs = {}
    subj_section_lab_to_facs = {}
    for subi in range(len(subj_list)):
        for si in range(S):
            subj_section_theory_to_facs[(subi, si)] = []
            subj_section_lab_to_facs[(subi, si)] = []

    for fi, f in enumerate(payload.faculty):
        for assignment in f.assignments:
            if assignment.subjectName in subj_index:
                subi = subj_index[assignment.subjectName]
                for sec_name in assignment.sections:
                    if sec_name in section_index:
                        si = section_index[sec_name]
                        if assignment.teachesTheory:
                            subj_section_theory_to_facs[(subi, si)].append(fi)
                        if assignment.teachesLab:
                            subj_section_lab_to_facs[(subi, si)].append(fi)

    D = payload.workingDays
    P = payload.periodsPerDay
    brk = payload.breakPeriod - 1  # zero-index break period

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

    # faculty assignment variables for theory: f_th[s,sub,d,p,fid]
    f_th = {}
    for si in range(S):
        for subi, sname in enumerate(subj_list):
            facs = subj_section_theory_to_facs.get((subi, si), [])
            for d in range(D):
                for p in range(P):
                    if p == brk: continue
                    for fid in facs:
                        f_th[(si, subi, d, p, fid)] = model.NewBoolVar(f"fth_s{si}_u{subi}_d{d}_p{p}_f{fid}")

    # faculty assignment variables for lab starts: f_lab[s,sub,d,p,fid]
    f_lab = {}
    for si in range(S):
        for subi, sname in enumerate(subj_list):
            facs = subj_section_lab_to_facs.get((subi, si), [])
            for d in range(D):
                for p in range(P - 1):
                    if p == brk or (p + 1) == brk: continue
                    for fid in facs:
                        f_lab[(si, subi, d, p, fid)] = model.NewBoolVar(f"flab_s{si}_u{subi}_d{d}_p{p}_f{fid}")

    # ---------- Linking constraints ----------

    # Link theory class with exactly one faculty when x==1
    for si in range(S):
        for subi, sname in enumerate(subj_list):
            facs = subj_section_theory_to_facs.get((subi, si), [])
            for d in range(D):
                for p in range(P):
                    if p == brk: continue
                    xi = x[(si, subi, d, p)]
                    if facs:
                        model.Add(sum(f_th[(si, subi, d, p, fid)] for fid in facs) == xi)
                    else:
                        model.Add(xi == 0)

    # Link lab start with exactly one faculty when lstart==1
    for si in range(S):
        for subi, sname in enumerate(subj_list):
            facs = subj_section_lab_to_facs.get((subi, si), [])
            for d in range(D):
                for p in range(P - 1):
                    if p == brk or (p + 1) == brk: continue
                    li = lstart[(si, subi, d, p)]
                    if facs:
                        model.Add(sum(f_lab[(si, subi, d, p, fid)] for fid in facs) == li)
                    else:
                        model.Add(li == 0)

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
                # Collect all theory and lab assignments for this faculty at this specific time slot.
                for si in range(S):
                    for subi in range(len(subj_list)):
                        # Theory class at this exact time
                        theory_key = (si, subi, d, p, fid)
                        if theory_key in f_th:
                            terms.append(f_th[theory_key])
                        # Lab class starting at this exact time
                        lab_start_key = (si, subi, d, p, fid)
                        if lab_start_key in f_lab:
                            terms.append(f_lab[lab_start_key])
                        # Lab class that started in the previous period and occupies this one
                        lab_cont_key = (si, subi, d, p - 1, fid)
                        if lab_cont_key in f_lab:
                            terms.append(f_lab[lab_cont_key])
                if terms:
                    model.Add(sum(terms) <= 1)

    # ---------- Room conflict constraints ----------
    # For theory rooms: for each theory room tr, day d, p: sum of classes assigned to this room <= 1
    for tr in range(T):
        for d in range(D):
            for p in range(P):
                if p == brk: continue
                classes_in_this_room = [
                    x[(si, subi, d, p)]
                    for si in range(S) for subi in range(len(subj_list))
                    if theory_assignment_map.get((si, subi)) == tr
                ]
                if classes_in_this_room:
                    model.Add(sum(classes_in_this_room) <= 1)

    # For lab rooms: for each lab room lr, day d, p: sum of labs occupying this period in this room <= 1
    for lr in range(L):
        for d in range(D):
            for p in range(P):
                if p == brk: continue
                labs_occupying_this_room = []
                for si in range(S):
                    for subi in range(len(subj_list)):
                        if lab_assignment_map.get((si, subi)) == lr:
                            if (si, subi, d, p) in lstart:
                                labs_occupying_this_room.append(lstart[(si, subi, d, p)])
                            if p > 0 and (si, subi, d, p - 1) in lstart:
                                labs_occupying_this_room.append(lstart[(si, subi, d, p - 1)])
                if labs_occupying_this_room:
                    model.Add(sum(labs_occupying_this_room) <= 1)

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
                        room_idx = theory_assignment_map.get((si, subi))
                        room_assigned = T_rooms[room_idx] if room_idx is not None else None
                        facs_indices = subj_section_theory_to_facs.get((subi, si), [])
                        fac_assigned = next((faculty_info[fid] for fid in facs_indices if solver.Value(f_th.get((si, subi, d, p, fid), 0)) == 1), None)
                        assigned_class = {"section": section_name, "subject": sname, "isLab": False, "room": room_assigned, "faculty": fac_assigned}
                        break

                if assigned_class:
                    day_periods[p] = assigned_class
                    continue

                # Check for lab class for this section (si)
                for subi, sname in enumerate(subj_list):
                    # Lab starting at p
                    if (si, subi, d, p) in lstart and solver.Value(lstart[(si, subi, d, p)]) == 1:
                        room_idx = lab_assignment_map.get((si, subi))
                        lr_assigned = L_rooms[room_idx] if room_idx is not None else None
                        facs_indices = subj_section_lab_to_facs.get((subi, si), [])
                        fac_assigned = next((faculty_info[fid] for fid in facs_indices if solver.Value(f_lab.get((si, subi, d, p, fid), 0)) == 1), None)
                        assigned_class = {"section": section_name, "subject": sname, "isLab": True, "room": lr_assigned, "faculty": fac_assigned, "note": "lab start"}
                        break

                    # Lab continuing from p-1
                    if p > 0 and (si, subi, d, p - 1) in lstart and solver.Value(lstart[(si, subi, d, p - 1)]) == 1:
                        room_idx = lab_assignment_map.get((si, subi))
                        lr_assigned = L_rooms[room_idx] if room_idx is not None else None
                        facs_indices = subj_section_lab_to_facs.get((subi, si), [])
                        fac_assigned = next((faculty_info[fid] for fid in facs_indices if solver.Value(f_lab.get((si, subi, d, p - 1, fid), 0)) == 1), None)
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
        "faculty": payload.faculty,
        "subjects": payload.subjects,
    }