# JAudioTagger reflects into its own tag/field classes and uses java.util.logging.
-keep class org.jaudiotagger.** { *; }
-dontwarn org.jaudiotagger.**
# JAudioTagger references desktop image classes that never get used on Android
# (we only read binary artwork data).
-dontwarn java.awt.**
-dontwarn javax.imageio.**
-dontwarn javax.swing.**
