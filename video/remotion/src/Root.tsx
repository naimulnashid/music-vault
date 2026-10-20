import { Composition } from "remotion";
import { HowItWorks } from "./HowItWorks";
import { calculateLoopMetadata, Loop } from "./Loop";
import { calculateMainMetadata, FPS, Main } from "./Main";
import { Title } from "./Title";

export const Root: React.FC = () => (
  <>
    {/* The length comes from the captured footage; 1 frame is only a placeholder. */}
    <Composition
      id="Main"
      component={Main}
      durationInFrames={1}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ manifest: null, phone: null }}
      calculateMetadata={calculateMainMetadata}
    />
    <Composition
      id="Loop"
      component={Loop}
      durationInFrames={1}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ manifest: null, phone: null }}
      calculateMetadata={calculateLoopMetadata}
    />
    <Composition id="Title" component={Title} durationInFrames={180} fps={30} width={1920} height={1080} />
    <Composition id="HowItWorks" component={HowItWorks} durationInFrames={300} fps={30} width={1920} height={1080} />
  </>
);
