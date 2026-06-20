package in.capitalvolts.callqpro;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CallStatePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
