from dataclasses import dataclass, asdict


@dataclass
class VisualScene:
    scene_number: int
    narration: str
    visual: str
    duration: float
    transition: str = "cut"


class VisualPlanner:

    def create_plan(self, script: str):
        if not script or not script.strip():
            raise ValueError("Script cannot be empty.")

        sentences = [
            sentence.strip()
            for sentence in script.replace("\n", " ").split(".")
            if sentence.strip()
        ]

        scenes = []

        for index, sentence in enumerate(sentences, start=1):
            scene = VisualScene(
                scene_number=index,
                narration=sentence,
                visual=f"Visual representation of: {sentence}",
                duration=5.0,
                transition="cut",
            )

            scenes.append(scene)

        return scenes

    def plan_to_dict(self, script: str):
        return [
            asdict(scene)
            for scene in self.create_plan(script)
        ]


def main():

    planner = VisualPlanner()

    test_script = (
        "Artificial intelligence is changing the way we create content. "
        "TikTok creators can now automate many parts of their workflow. "
        "A good visual plan helps turn a script into an engaging video."
    )

    scenes = planner.create_plan(test_script)

    print()
    print("=== VISUAL PLAN ===")
    print()

    for scene in scenes:
        print(f"Scene {scene.scene_number}")
        print(f"Narration : {scene.narration}")
        print(f"Visual    : {scene.visual}")
        print(f"Duration  : {scene.duration}s")
        print(f"Transition: {scene.transition}")
        print("-" * 50)


if __name__ == "__main__":
    main()