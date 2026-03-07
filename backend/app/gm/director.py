from app.gm.models import DirectorAct, DirectorArc


def get_current_act(arc: DirectorArc, round_number: int) -> DirectorAct:
    for act in arc.acts:
        if act.start_round <= round_number <= act.end_round:
            return act
    return arc.acts[-1]


def get_next_act(arc: DirectorArc, round_number: int) -> DirectorAct | None:
    current_act = get_current_act(arc, round_number)
    current_index = arc.acts.index(current_act)
    if current_index + 1 >= len(arc.acts):
        return None
    return arc.acts[current_index + 1]


def is_act_transition(arc: DirectorArc, round_number: int) -> bool:
    if round_number <= 1:
        return False
    return get_current_act(arc, round_number).name != get_current_act(arc, round_number - 1).name


def validate_arc(arc: DirectorArc) -> None:
    previous_end = 0
    for act in arc.acts:
        if act.start_round > act.end_round:
            raise ValueError(f"act '{act.name}' starts after it ends")
        if act.start_round != previous_end + 1:
            raise ValueError("arc acts must form a contiguous round sequence")
        previous_end = act.end_round
